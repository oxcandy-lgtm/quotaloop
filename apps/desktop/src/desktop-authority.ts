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
} from "@quotaloop/contracts";
import {
  DesktopStateRepository,
  defaultDesktopState,
} from "./desktop-state-repository";
import { syntheticScores } from "./model-lab/synthetic-catalog";

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
  private readonly repository = new DesktopStateRepository();
  private onRecord: ((eventKey: string) => void | Promise<void>) | null = null;

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
  async hydrate() {
    this.persistent = this.repository.load();
    this.controller.hydrateState(
      this.persistent.automationPolicy,
      this.persistent.executionHistory,
    );
    this.servicePreferences = this.persistent.preferences.aiServices;
    this.hydrated = true;
    this.revision += 1;
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
      },
      providerStates: this.providerStates,
      modelLabRunState: this.modelLabRunState,
      notificationPermission: this.notificationPermission,
    };
  }
  setProviderStates(states: DesktopRuntimeSnapshotV2["providerStates"]) {
    this.providerStates = states;
    this.revision += 1;
  }
  setServicePreferences(preferences: AIServicePreference[]) {
    this.servicePreferences = preferences;
    this.persistent.preferences = {
      ...this.persistent.preferences,
      aiServices: preferences,
    };
    this.repository.save(this.persistent);
    this.revision += 1;
  }
  setPolicy(policy: Parameters<DesktopAutomationController["setPolicy"]>[0]) {
    this.controller.setPolicy(policy);
    this.persistent.automationPolicy = policy;
    this.repository.save(this.persistent);
    this.revision += 1;
  }
  syncHistory() {
    this.persistent.executionHistory = this.controller.records;
    this.repository.save(this.persistent);
    this.revision += 1;
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
    this.revision += 1;
  }
  setNotificationPermission(permission: NotificationPermissionState) {
    this.notificationPermission = permission;
    this.revision += 1;
  }
  get lastNotificationKey() {
    return this.lastNotificationEventKey;
  }
  set lastNotificationKey(value: string | null) {
    this.lastNotificationEventKey = value;
  }
  async runModelLab(
    execute: () => Promise<void>,
  ): Promise<DesktopRequestResult> {
    if (!this.hydrated)
      return {
        requestId: "",
        accepted: false,
        revision: this.revision,
        reason: "authority_not_ready",
      };
    if (this.modelLab.isRunning)
      return {
        requestId: "",
        accepted: false,
        revision: this.revision,
        reason: "execution_in_progress",
      };
    this.modelLabRunState = {
      status: "running",
      progress: 0,
      runId: crypto.randomUUID(),
    };
    this.revision += 1;
    for (const progress of [25, 50, 75]) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      this.modelLabRunState = { ...this.modelLabRunState, progress };
      this.revision += 1;
    }
    const result = await this.modelLab.run(execute);
    if (result === "completed") {
      const record: ModelLabHistory = {
        id: crypto.randomUUID(),
        modelIds: syntheticScores.map((score) => score.modelId),
        completedAt: new Date().toISOString(),
        outcome: "success",
        results: Object.fromEntries(
          syntheticScores.map((score) => [score.modelId, score.score]),
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
    this.revision += 1;
    const reason =
      result === "duplicate"
        ? "execution_in_progress"
        : result === "discarded"
          ? "reset_generation"
          : undefined;
    return reason
      ? { requestId: "", accepted: false, revision: this.revision, reason }
      : { requestId: "", accepted: true, revision: this.revision };
  }
  start() {
    if (this.hydrated) this.scheduler.start();
  }
  stop() {
    this.scheduler.stop();
  }
  resume() {
    this.scheduler.resume();
  }
  async runManual(now = new Date()) {
    const result = await this.controller.evaluateAndRun(now, true);
    if (result.record) this.syncHistory();
    return result;
  }
  reset() {
    this.modelLab.reset();
    this.modelLabRunState = { status: "idle", progress: 0, runId: null };
    this.revision += 1;
    const result = this.controller.resetToSafeDefaults();
    this.persistent = defaultDesktopState();
    this.repository.clear();
    return result;
  }
}
