import { LocalScheduler } from "@quotaloop/automation";
import { DesktopAutomationController } from "./automation-controller";
import { ModelLabController } from "./model-lab-controller";
import type {
  AIServicePreference,
  DesktopRequestResult,
  DesktopRuntimeSnapshotV2,
  ModelLabRunState,
} from "@quotaloop/contracts";

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
  private onRecord: ((eventKey: string) => void | Promise<void>) | null = null;

  constructor(
    provider?: ConstructorParameters<typeof DesktopAutomationController>[0],
  ) {
    this.controller = new DesktopAutomationController(provider);
    this.scheduler = new LocalScheduler(async () => {
      const result = await this.controller.evaluateAndRun();
      if (result.record && this.onRecord) await this.onRecord(result.eventKey);
    }, 60_000);
  }
  setOnRecord(callback: (eventKey: string) => void | Promise<void>) {
    this.onRecord = callback;
  }
  async hydrate() {
    this.hydrated = true;
    this.revision += 1;
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
          theme: "system",
          aiServices: this.servicePreferences,
          credentials: [],
          notifications: { enabled: false, actionCompleted: true },
        },
        automationPolicy: this.controller.currentPolicy,
        executionHistory: this.controller.records,
        modelLabPreferences: { selectedModelIds: [] },
        modelLabHistory: [],
        subscriptions: [],
      },
      providerStates: this.providerStates,
      modelLabRunState: this.modelLabRunState,
      notificationPermission: "unknown",
    };
  }
  setProviderStates(states: DesktopRuntimeSnapshotV2["providerStates"]) {
    this.providerStates = states;
    this.revision += 1;
  }
  setServicePreferences(preferences: AIServicePreference[]) {
    this.servicePreferences = preferences;
    this.revision += 1;
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
    this.modelLabRunState = {
      status: "running",
      progress: 0,
      runId: crypto.randomUUID(),
    };
    this.revision += 1;
    const result = await this.modelLab.run(execute);
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
    return this.controller.evaluateAndRun(now, true);
  }
  reset() {
    this.modelLab.reset();
    this.modelLabRunState = { status: "idle", progress: 0, runId: null };
    this.revision += 1;
    return this.controller.resetToSafeDefaults();
  }
}
