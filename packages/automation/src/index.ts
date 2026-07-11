export class LocalScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly evaluate: () => void | Promise<void>,
    private readonly intervalMs = 60_000,
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.evaluate(), this.intervalMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  resume() {
    this.stop();
    this.start();
    void this.evaluate();
  }
  get running() {
    return this.timer !== null;
  }
}
