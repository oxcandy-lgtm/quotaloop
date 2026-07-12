export class LocalScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private _lastError: unknown = null;
  constructor(
    private readonly evaluate: () => void | Promise<void>,
    private readonly intervalMs = 60_000,
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  resume() {
    if (!this.timer) this.start();
    void this.tick();
  }
  private async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.evaluate();
      this._lastError = null;
    } catch (error) {
      this._lastError = error;
    } finally {
      this.inFlight = false;
    }
  }
  get inFlightEvaluation() {
    return this.inFlight;
  }
  get lastError() {
    return this._lastError;
  }
  get running() {
    return this.timer !== null;
  }
}
