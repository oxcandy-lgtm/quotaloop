import { LocalScheduler } from "@quotaloop/automation";
import { DesktopAutomationController } from "./automation-controller";
import { ModelLabController } from "./model-lab-controller";
import type {
  AIServicePreference,
  DesktopRequestResult,
  DesktopRuntimeSnapshotV2,
  ModelLabRunState,
  ModelLabHistory,
  NotificationPermissionState,
  SubscriptionMutation,
  OpenRouterBenchmarkResult,
  OpenRouterPersistentState,
} from "@quotaloop/contracts";
import {
  desktopRequestEnvelopeSchema,
  desktopRequestPayloadSchemas,
  modelLabSelectionSchema,
  subscriptionMutationSchema,
} from "@quotaloop/contracts";
import { serviceDefinitions } from "@quotaloop/providers";
import {
  DesktopStateRepository,
  defaultDesktopState,
} from "./desktop-state-repository";
import {
  syntheticCatalog,
  syntheticScores,
} from "./model-lab/synthetic-catalog";
import { normalizeOpenRouterCatalog } from "./openrouter/catalog";
import { OPENROUTER_BENCHMARK_MANIFEST } from "./openrouter/benchmark-manifest";
import {
  OpenRouterBenchmarkRunner,
  type OpenRouterModelRunner,
  type OpenRouterRunnerStore,
} from "./openrouter/runner";

class MemoryOpenRouterStore implements OpenRouterRunnerStore {
  constructor(private state: OpenRouterPersistentState) {}
  load() {
    return this.state.benchmarkRun;
  }
  save(state: OpenRouterPersistentState["benchmarkRun"]) {
    this.state = { ...this.state, benchmarkRun: state };
  }
}

const defaultServicePreferences = (): AIServicePreference[] =>
  serviceDefinitions.map((service) => ({
    serviceId: service.serviceId,
    enabled: true,
    visibleInQuota: service.supportsQuotaSurface,
    visibleInModelLab: service.supportsModelLab,
    allowCatalogAccess: service.supportsCatalog,
    allowBenchmarkRequests: service.supportsBenchmark,
    favorite: service.integrationLevel === "mock",
  }));

export class DesktopAuthority {
  readonly controller: DesktopAutomationController;
  readonly scheduler: LocalScheduler;
  readonly modelLab = new ModelLabController();
  private hydrated = false;
  private revision = 0;
  private providerStates: DesktopRuntimeSnapshotV2["providerStates"] = [];
  private modelLabRunState: ModelLabRunState = {
    status: "idle",
    progress: 0,
    runId: null,
  };
  private servicePreferences: AIServicePreference[] = [];
  private notificationPermission: NotificationPermissionState = "unknown";
  private lastNotificationEventKey: string | null = null;
  private persistent = defaultDesktopState();
  private openrouterRunner: OpenRouterBenchmarkRunner | null = null;
  private openrouterStore: MemoryOpenRouterStore | null = null;
  private openrouterGeneration = 0;
  private readonly repository = new DesktopStateRepository();
  private onRecord: ((eventKey: string) => void | Promise<void>) | null = null;
  private onSnapshot: (() => void) | null = null;

  constructor(
    provider?: ConstructorParameters<typeof DesktopAutomationController>[0],
  ) {
    this.controller = new DesktopAutomationController(provider);
    this.scheduler = new LocalScheduler(async () => {
      const result = await this.controller.evaluateAndRun();
      if (result.record) this.syncHistory();
      if (result.record && this.onRecord) await this.onRecord(result.eventKey);
    }, 60_000);
  }
  setOnRecord(callback: (eventKey: string) => void | Promise<void>) {
    this.onRecord = callback;
  }
  setOnSnapshot(callback: () => void) {
    this.onSnapshot = callback;
  }
  private changed() {
    this.revision += 1;
    this.onSnapshot?.();
  }
  async hydrate() {
    this.persistent = this.repository.load();
    if (this.persistent.openrouter.benchmarkRun.status === "running") {
      this.persistent.openrouter.benchmarkRun = {
        ...this.persistent.openrouter.benchmarkRun,
        status: "interrupted",
        currentModelId: null,
        updatedAt: new Date().toISOString(),
      };
    }
    this.controller.hydrateState(
      this.persistent.automationPolicy,
      this.persistent.executionHistory,
    );
    const knownServices = new Set(
      serviceDefinitions.map((service) => service.serviceId),
    );
    this.persistent.subscriptions = this.persistent.subscriptions.filter(
      (subscription) => knownServices.has(subscription.providerId),
    );
    const knownModels = new Set(syntheticCatalog.map((model) => model.id));
    this.persistent.modelLabPreferences = {
      selectedModelIds:
        this.persistent.modelLabPreferences.selectedModelIds.filter((modelId) =>
          knownModels.has(modelId),
        ),
    };
    this.persistent.modelLabHistory = this.persistent.modelLabHistory.filter(
      (record) => record.modelIds.every((modelId) => knownModels.has(modelId)),
    );
    const seenServices = new Set<string>();
    this.servicePreferences = this.persistent.preferences.aiServices
      .filter((preference) => knownServices.has(preference.serviceId))
      .map((preference) => {
        if (!seenServices.has(preference.serviceId)) {
          seenServices.add(preference.serviceId);
          return preference;
        }
        return {
          ...preference,
          enabled: false,
          visibleInQuota: false,
          visibleInModelLab: false,
          allowCatalogAccess: false,
          allowBenchmarkRequests: false,
          favorite: false,
        };
      });
    if (!this.servicePreferences.length)
      this.servicePreferences = defaultServicePreferences();
    this.persistent.preferences = {
      ...this.persistent.preferences,
      aiServices: this.servicePreferences,
    };
    this.lastNotificationEventKey = this.persistent.lastNotificationEventKey;
    this.hydrated = true;
    this.changed();
    this.repository.save(this.persistent);
  }
  get isHydrated() {
    return this.hydrated;
  }
  getSnapshot(): DesktopRuntimeSnapshotV2 {
    return {
      schemaVersion: 2,
      revision: this.revision,
      hydrated: this.hydrated,
      persistent: {
        schemaVersion: 2,
        preferences: {
          ...this.persistent.preferences,
          aiServices: this.servicePreferences,
        },
        automationPolicy: this.controller.currentPolicy,
        executionHistory: this.controller.records,
        modelLabPreferences: this.persistent.modelLabPreferences,
        modelLabHistory: this.persistent.modelLabHistory,
        subscriptions: this.persistent.subscriptions,
        lastNotificationEventKey: this.persistent.lastNotificationEventKey,
        openrouter: this.persistent.openrouter,
      },
      providerStates: this.providerStates,
      modelLabRunState: this.modelLabRunState,
      notificationPermission: this.notificationPermission,
      openrouter: this.persistent.openrouter,
    };
  }
  setProviderStates(states: DesktopRuntimeSnapshotV2["providerStates"]) {
    this.providerStates = states;
    this.changed();
  }
  setServicePreferences(preferences: AIServicePreference[]) {
    this.servicePreferences = preferences;
    this.persistent.preferences = {
      ...this.persistent.preferences,
      aiServices: preferences,
    };
    this.repository.save(this.persistent);
    this.changed();
  }
  setPolicy(policy: Parameters<DesktopAutomationController["setPolicy"]>[0]) {
    this.controller.setPolicy(policy);
    this.persistent.automationPolicy = policy;
    this.repository.save(this.persistent);
    this.changed();
  }
  syncHistory() {
    this.persistent.executionHistory = this.controller.records;
    this.repository.save(this.persistent);
    this.changed();
  }
  setNotificationPreferences(preferences: {
    enabled: boolean;
    actionCompleted: boolean;
  }) {
    this.persistent.preferences = {
      ...this.persistent.preferences,
      notifications: preferences,
    };
    this.repository.save(this.persistent);
    this.changed();
  }
  setNotificationPermission(permission: NotificationPermissionState) {
    this.notificationPermission = permission;
    this.changed();
  }
  get lastNotificationKey() {
    return this.lastNotificationEventKey;
  }
  set lastNotificationKey(value: string | null) {
    this.lastNotificationEventKey = value;
    this.persistent.lastNotificationEventKey = value;
    if (this.hydrated) {
      this.repository.save(this.persistent);
      this.changed();
    }
  }

  async handleRequest(
    input: unknown,
    callbacks: {
      refreshProviders?: () => Promise<void>;
      manualAction?: () => Promise<void>;
      modelLabAction?: () => Promise<void>;
      openrouterCatalog?: () => Promise<unknown>;
      openrouterRunModel?: OpenRouterModelRunner;
      openrouterCancel?: () => Promise<void>;
      openrouterKeyStatus?: () => Promise<{ configured: boolean }>;
    } = {},
  ): Promise<DesktopRequestResult> {
    const envelope = desktopRequestEnvelopeSchema.safeParse(input);
    if (!envelope.success) {
      const requestId =
        typeof input === "object" &&
        input !== null &&
        "requestId" in input &&
        typeof input.requestId === "string"
          ? input.requestId
          : crypto.randomUUID();
      return {
        requestId,
        accepted: false,
        revision: this.revision,
        reason: "invalid_request_envelope",
      };
    }
    const request = envelope.data;
    const payloadSchema = desktopRequestPayloadSchemas[request.type];
    const payload = payloadSchema.safeParse(request.payload);
    if (!payload.success)
      return {
        requestId: request.requestId,
        accepted: false,
        revision: this.revision,
        reason: "invalid_request_payload",
      };
    if (!this.hydrated && request.type !== "desktop_snapshot_requested")
      return {
        requestId: request.requestId,
        accepted: false,
        revision: this.revision,
        reason: "authority_not_ready",
      };
    switch (request.type) {
      case "desktop_snapshot_requested":
        this.onSnapshot?.();
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      case "refresh_providers_requested":
        await callbacks.refreshProviders?.();
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      case "automation_policy_requested":
        this.setPolicy(
          payload.data as Parameters<
            DesktopAutomationController["setPolicy"]
          >[0],
        );
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      case "service_preference_requested": {
        const preference = payload.data as AIServicePreference;
        const service = serviceDefinitions.find(
          (item) => item.serviceId === preference.serviceId,
        );
        if (!service)
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "unknown_service",
          };
        if (
          (preference.visibleInQuota && !service.supportsQuotaSurface) ||
          (preference.visibleInModelLab && !service.supportsModelLab) ||
          (preference.allowCatalogAccess && !service.supportsCatalog) ||
          (preference.allowBenchmarkRequests && !service.supportsBenchmark)
        )
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "unsupported_capability",
          };
        this.setServicePreferences(
          this.servicePreferences.map((item) =>
            item.serviceId === preference.serviceId ? preference : item,
          ),
        );
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      }
      case "model_lab_selection_requested": {
        const selection = modelLabSelectionSchema.parse(payload.data);
        const demoService = this.servicePreferences.find(
          (item) => item.serviceId === "codex-demo",
        );
        if (
          !demoService?.enabled ||
          !demoService.visibleInModelLab ||
          !demoService.allowBenchmarkRequests
        )
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "benchmark_not_allowed",
          };
        const allowed = new Set(syntheticCatalog.map((item) => item.id));
        if (selection.selectedModelIds.some((id) => !allowed.has(id)))
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "unknown_model",
          };
        this.persistent.modelLabPreferences = {
          selectedModelIds: [...new Set(selection.selectedModelIds)],
        };
        this.repository.save(this.persistent);
        this.changed();
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      }
      case "notification_preference_requested":
        this.setNotificationPreferences(
          payload.data as { enabled: boolean; actionCompleted: boolean },
        );
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      case "subscription_requested":
        return this.mutateSubscription(
          subscriptionMutationSchema.parse(payload.data),
          request.requestId,
        );
      case "clear_local_data_requested":
        this.reset();
        this.onSnapshot?.();
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      case "manual_action_requested":
        await callbacks.manualAction?.();
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      case "model_lab_run_requested":
        return this.runModelLab(
          callbacks.modelLabAction ?? (async () => undefined),
          request.requestId,
        );
      case "openrouter_catalog_refresh_requested": {
        if (!callbacks.openrouterCatalog)
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "native_unavailable",
          };
        try {
          const raw = await callbacks.openrouterCatalog();
          this.persistent.openrouter.catalog = normalizeOpenRouterCatalog(raw);
          this.repository.save(this.persistent);
          this.changed();
          return {
            requestId: request.requestId,
            accepted: true,
            revision: this.revision,
          };
        } catch {
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "catalog_refresh_failed",
          };
        }
      }
      case "openrouter_benchmark_requested": {
        const input = payload.data as {
          modelIds: string[];
          catalogHash: string;
        };
        const catalog = this.persistent.openrouter.catalog;
        if (!catalog || catalog.catalogHash !== input.catalogHash)
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "catalog_changed",
          };
        if (!callbacks.openrouterRunModel)
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "native_unavailable",
          };
        if (callbacks.openrouterKeyStatus) {
          try {
            if (!(await callbacks.openrouterKeyStatus()).configured)
              return {
                requestId: request.requestId,
                accepted: false,
                revision: this.revision,
                reason: "key_not_configured",
              };
          } catch {
            return {
              requestId: request.requestId,
              accepted: false,
              revision: this.revision,
              reason: "key_status_unavailable",
            };
          }
        }
        this.ensureOpenRouterRunner(callbacks.openrouterRunModel);
        const accepted = this.openrouterRunner!.runAllFreeModels(
          catalog,
          input.modelIds,
        );
        this.syncOpenRouterRunner();
        return {
          requestId: request.requestId,
          accepted,
          revision: this.revision,
          ...(accepted ? {} : { reason: "execution_in_progress" }),
        };
      }
      case "openrouter_benchmark_pause_requested":
        if (!this.openrouterRunner?.pause())
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "not_running",
          };
        this.syncOpenRouterRunner();
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      case "openrouter_benchmark_resume_requested":
        if (!callbacks.openrouterRunModel)
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "native_unavailable",
          };
        this.ensureOpenRouterRunner(callbacks.openrouterRunModel);
        if (
          !this.openrouterRunner?.resume(
            this.persistent.openrouter.catalog ?? undefined,
          )
        )
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "not_paused",
          };
        this.syncOpenRouterRunner();
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
      case "openrouter_benchmark_cancel_requested":
        if (callbacks.openrouterCancel) await callbacks.openrouterCancel();
        if (!this.openrouterRunner?.cancel())
          return {
            requestId: request.requestId,
            accepted: false,
            revision: this.revision,
            reason: "not_running",
          };
        this.syncOpenRouterRunner();
        return {
          requestId: request.requestId,
          accepted: true,
          revision: this.revision,
        };
    }
  }

  private ensureOpenRouterRunner(runModel: OpenRouterModelRunner) {
    if (this.openrouterRunner) return;
    const generation = this.openrouterGeneration;
    this.openrouterStore = new MemoryOpenRouterStore(
      this.persistent.openrouter,
    );
    this.openrouterRunner = new OpenRouterBenchmarkRunner(
      OPENROUTER_BENCHMARK_MANIFEST,
      this.openrouterStore,
      runModel,
      (result: OpenRouterBenchmarkResult) => {
        if (generation !== this.openrouterGeneration) return;
        const existing = this.persistent.openrouter.benchmarkResults;
        const id =
          result.id &&
          !existing.some(
            (item) => item.id === result.id && item.modelId !== result.modelId,
          )
            ? result.id
            : `${result.id || this.openrouterRunner?.getSnapshot().runId}:${result.modelId}`;
        const normalizedResult = {
          ...result,
          id,
          catalogHash:
            this.persistent.openrouter.catalog?.catalogHash ??
            result.catalogHash,
        };
        if (!existing.some((item) => item.id === normalizedResult.id))
          this.persistent.openrouter.benchmarkResults = [
            normalizedResult,
            ...existing,
          ].slice(0, 100);
        this.syncOpenRouterRunner();
      },
      3200,
      () => this.syncOpenRouterRunner(),
    );
  }

  private syncOpenRouterRunner() {
    if (!this.openrouterRunner) return;
    this.persistent.openrouter.benchmarkRun =
      this.openrouterRunner.getSnapshot();
    this.repository.save(this.persistent);
    this.changed();
  }

  private mutateSubscription(
    mutation: SubscriptionMutation,
    requestId: string,
  ): DesktopRequestResult {
    const subscriptions = this.persistent.subscriptions;
    if (
      mutation.operation !== "remove" &&
      !serviceDefinitions.some(
        (service) => service.serviceId === mutation.subscription.providerId,
      )
    )
      return {
        requestId,
        accepted: false,
        revision: this.revision,
        reason: "unknown_service",
      };
    if (mutation.operation === "remove") {
      if (!subscriptions.some((item) => item.id === mutation.subscriptionId))
        return {
          requestId,
          accepted: false,
          revision: this.revision,
          reason: "unknown_subscription",
        };
      this.persistent.subscriptions = subscriptions.filter(
        (item) => item.id !== mutation.subscriptionId,
      );
    } else if (mutation.operation === "add") {
      if (subscriptions.some((item) => item.id === mutation.subscription.id))
        return {
          requestId,
          accepted: false,
          revision: this.revision,
          reason: "duplicate_subscription",
        };
      this.persistent.subscriptions = [mutation.subscription, ...subscriptions];
    } else {
      if (!subscriptions.some((item) => item.id === mutation.subscription.id))
        return {
          requestId,
          accepted: false,
          revision: this.revision,
          reason: "unknown_subscription",
        };
      this.persistent.subscriptions = subscriptions.map((item) =>
        item.id === mutation.subscription.id ? mutation.subscription : item,
      );
    }
    this.repository.save(this.persistent);
    this.changed();
    return { requestId, accepted: true, revision: this.revision };
  }
  async runModelLab(
    execute: () => Promise<void>,
    requestId: string = crypto.randomUUID(),
  ): Promise<DesktopRequestResult> {
    if (!this.hydrated)
      return {
        requestId,
        accepted: false,
        revision: this.revision,
        reason: "authority_not_ready",
      };
    const demoService = this.servicePreferences.find(
      (item) => item.serviceId === "codex-demo",
    );
    if (
      !demoService?.enabled ||
      !demoService.visibleInModelLab ||
      !demoService.allowBenchmarkRequests
    )
      return {
        requestId,
        accepted: false,
        revision: this.revision,
        reason: "benchmark_not_allowed",
      };
    const started = this.modelLab.startRun();
    if (!started.accepted)
      return {
        requestId,
        accepted: false,
        revision: this.revision,
        reason: "execution_in_progress",
      };
    this.modelLabRunState = {
      status: "running",
      progress: 0,
      runId: started.runId,
    };
    this.changed();
    let result: "completed" | "discarded" | "duplicate" | "failed";
    for (const progress of [25, 50, 75]) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (!this.modelLab.isCurrentGeneration(started.generation)) break;
      this.modelLabRunState = { ...this.modelLabRunState, progress };
      this.changed();
    }
    if (!this.modelLab.isCurrentGeneration(started.generation)) {
      result = "discarded";
    } else {
      try {
        await execute();
        result = this.modelLab.isCurrentGeneration(started.generation)
          ? "completed"
          : "discarded";
      } catch {
        result = "failed";
      }
    }
    this.modelLab.finishRun();
    if (result === "completed") {
      const selectedModelIds = this.persistent.modelLabPreferences
        .selectedModelIds.length
        ? this.persistent.modelLabPreferences.selectedModelIds
        : [syntheticScores[0]!.modelId];
      const record: ModelLabHistory = {
        id: crypto.randomUUID(),
        modelIds: selectedModelIds,
        completedAt: new Date().toISOString(),
        outcome: "success",
        results: Object.fromEntries(
          syntheticScores
            .filter((score) => selectedModelIds.includes(score.modelId))
            .map((score) => [score.modelId, score.score]),
        ),
      };
      this.persistent.modelLabHistory = [
        record,
        ...this.persistent.modelLabHistory,
      ].slice(0, 20);
      this.repository.save(this.persistent);
    }
    this.modelLabRunState = {
      status:
        result === "completed"
          ? "completed"
          : result === "discarded"
            ? "idle"
            : "failed",
      progress: result === "completed" ? 100 : 0,
      runId: null,
    };
    this.changed();
    const reason =
      result === "discarded"
        ? "reset_generation"
        : result === "failed"
          ? "execution_failed"
          : undefined;
    return reason
      ? { requestId, accepted: false, revision: this.revision, reason }
      : { requestId, accepted: true, revision: this.revision };
  }
  start() {
    if (this.hydrated) this.scheduler.start();
  }
  stop() {
    this.scheduler.stop();
  }
  resume() {
    if (this.hydrated) this.scheduler.resume();
  }
  async runManual(now = new Date()) {
    const result = await this.controller.evaluateAndRun(now, true);
    if (result.record) this.syncHistory();
    return result;
  }
  reset() {
    this.modelLab.reset();
    this.modelLabRunState = { status: "idle", progress: 0, runId: null };
    this.notificationPermission = "unknown";
    this.lastNotificationEventKey = null;
    const result = this.controller.resetToSafeDefaults();
    this.persistent = defaultDesktopState();
    this.openrouterGeneration += 1;
    this.openrouterRunner?.cancel();
    this.openrouterRunner = null;
    this.openrouterStore = null;
    this.repository.clear();
    this.changed();
    return result;
  }
}
