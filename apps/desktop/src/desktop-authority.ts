import { LocalScheduler } from "@quotaloop/automation";
import { DesktopAutomationController } from "./automation-controller";
import { ModelLabController } from "./model-lab-controller";

export class DesktopAuthority {
  readonly controller: DesktopAutomationController;
  readonly scheduler: LocalScheduler;
  readonly modelLab = new ModelLabController();
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
  start() {
    this.scheduler.start();
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
    return this.controller.resetToSafeDefaults();
  }
}
