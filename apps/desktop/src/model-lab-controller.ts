export class ModelLabController {
  private generation = 0;
  private running = false;
  reset() {
    this.generation += 1;
    this.running = false;
  }
  get isRunning() {
    return this.running;
  }
  async run(
    execute: () => Promise<void>,
  ): Promise<"completed" | "discarded" | "duplicate"> {
    if (this.running) return "duplicate";
    const generation = this.generation;
    this.running = true;
    try {
      await execute();
      return generation === this.generation ? "completed" : "discarded";
    } finally {
      this.running = false;
    }
  }
}
