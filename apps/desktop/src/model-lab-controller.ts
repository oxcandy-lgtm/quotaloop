export class ModelLabController {
  private generation = 0;
  private running = false;
  private runId: string | null = null;
  startRun():
    | { accepted: true; runId: string; generation: number }
    | { accepted: false; reason: "execution_in_progress" } {
    if (this.running)
      return { accepted: false, reason: "execution_in_progress" };
    this.running = true;
    this.runId = crypto.randomUUID();
    return { accepted: true, runId: this.runId, generation: this.generation };
  }
  finishRun() {
    this.running = false;
    this.runId = null;
  }
  isCurrentGeneration(generation: number) {
    return generation === this.generation;
  }
  get activeRunId() {
    return this.runId;
  }
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
    const accepted = this.startRun();
    if (!accepted.accepted) return "duplicate";
    try {
      await execute();
      return this.isCurrentGeneration(accepted.generation)
        ? "completed"
        : "discarded";
    } finally {
      this.finishRun();
    }
  }
}
