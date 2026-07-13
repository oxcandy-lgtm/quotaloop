import type {
  OpenRouterBenchmarkManifest,
  OpenRouterBenchmarkResult,
  OpenRouterBenchmarkRunState,
  OpenRouterCatalogSnapshot,
} from "@quotaloop/contracts";

export type OpenRouterModelRunner = (input: {
  modelId: string;
  runId: string;
  manifest: OpenRouterBenchmarkManifest;
  catalogHash?: string;
}) => Promise<OpenRouterBenchmarkResult>;

export interface OpenRouterRunnerStore {
  load(): OpenRouterBenchmarkRunState;
  save(state: OpenRouterBenchmarkRunState): void;
}

const now = () => new Date().toISOString();
const MAX_RETRIES = 3;

export class OpenRouterBenchmarkRunner {
  private state: OpenRouterBenchmarkRunState;
  private currentPromise: Promise<void> | null = null;
  private pauseRequested = false;
  private cancelRequested = false;
  private readonly store: OpenRouterRunnerStore;
  constructor(
    private readonly manifest: OpenRouterBenchmarkManifest,
    store: OpenRouterRunnerStore,
    private readonly runModel: OpenRouterModelRunner,
    private readonly onResult: (result: OpenRouterBenchmarkResult) => void,
    private readonly delayMs = 3200,
    private readonly onState?: (state: OpenRouterBenchmarkRunState) => void,
  ) {
    this.store = store;
    this.state = store.load();
    if (this.state.status === "running") {
      this.state = {
        ...this.state,
        status: "interrupted",
        currentModelId: null,
        updatedAt: now(),
      };
      this.store.save(this.state);
    }
  }
  getSnapshot() {
    return this.state;
  }
  runAllFreeModels(
    catalog: OpenRouterCatalogSnapshot,
    requestedIds?: string[],
  ) {
    if (this.currentPromise || this.state.status === "running") return false;
    const ids = (
      requestedIds?.length
        ? requestedIds
        : catalog.eligibleModels.map((model) => model.id)
    ).filter(
      (id, index, all) =>
        all.indexOf(id) === index &&
        catalog.eligibleModels.some((model) => model.id === id),
    );
    if (!ids.length) return false;
    const runId = crypto.randomUUID();
    const completed =
      this.state.catalogHash === catalog.catalogHash && this.state.runId
        ? this.state.completedModelIds
        : [];
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.state = {
      runId,
      status: "running",
      mode: "live",
      modelIds: ids,
      completedModelIds: completed.filter((id) => ids.includes(id)),
      currentModelId: null,
      progress: Math.round((completed.length / ids.length) * 100),
      startedAt: now(),
      updatedAt: now(),
      catalogHash: catalog.catalogHash,
      manifestHash: this.manifest.manifestHash,
      concurrency: 1,
      delayMs: 3200,
    };
    this.persist();
    this.currentPromise = this.execute(catalog).finally(() => {
      this.currentPromise = null;
    });
    return true;
  }
  pause() {
    if (this.state.status !== "running") return false;
    this.pauseRequested = true;
    this.state = { ...this.state, status: "paused", updatedAt: now() };
    this.persist();
    return true;
  }
  resume() {
    if (this.state.status !== "paused" && this.state.status !== "interrupted")
      return false;
    this.pauseRequested = false;
    this.state = { ...this.state, status: "running", updatedAt: now() };
    this.persist();
    if (!this.currentPromise && this.state.catalogHash) {
      // The authority calls runAllFreeModels with the same frozen catalog after resume.
      return true;
    }
    return true;
  }
  cancel() {
    if (
      !this.currentPromise &&
      this.state.status !== "running" &&
      this.state.status !== "paused"
    )
      return false;
    this.cancelRequested = true;
    this.state = {
      ...this.state,
      status: "cancelled",
      currentModelId: null,
      updatedAt: now(),
    };
    this.persist();
    return true;
  }
  private persist() {
    this.store.save(this.state);
    this.onState?.(this.state);
  }
  private async execute(_catalog: OpenRouterCatalogSnapshot) {
    const ids = this.state.modelIds;
    for (const modelId of ids) {
      if (this.cancelRequested) break;
      while (this.pauseRequested)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.cancelRequested) break;
      if (this.state.completedModelIds.includes(modelId)) continue;
      this.state = { ...this.state, currentModelId: modelId, updatedAt: now() };
      this.persist();
      try {
        const modelInput: {
          modelId: string;
          runId: string;
          manifest: OpenRouterBenchmarkManifest;
          catalogHash?: string;
        } = {
          modelId,
          runId: this.state.runId!,
          manifest: this.manifest,
        };
        if (this.state.catalogHash)
          modelInput.catalogHash = this.state.catalogHash;
        const result = await this.runModelWithRetry(modelInput);
        this.onResult(result);
        this.state = {
          ...this.state,
          completedModelIds: [...this.state.completedModelIds, modelId],
          progress: Math.round(
            ((this.state.completedModelIds.length + 1) / ids.length) * 100,
          ),
          currentModelId: null,
          updatedAt: now(),
        };
        this.persist();
      } catch {
        this.state = {
          ...this.state,
          status: "failed",
          currentModelId: null,
          updatedAt: now(),
        };
        this.persist();
        return;
      }
      if (this.state.completedModelIds.length < ids.length)
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    this.state = {
      ...this.state,
      status: this.cancelRequested
        ? "cancelled"
        : this.pauseRequested
          ? "paused"
          : "completed",
      currentModelId: null,
      progress: this.cancelRequested ? this.state.progress : 100,
      updatedAt: now(),
    };
    this.persist();
  }
  private async runModelWithRetry(input: {
    modelId: string;
    runId: string;
    manifest: OpenRouterBenchmarkManifest;
    catalogHash?: string;
  }) {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      if (this.cancelRequested) throw new Error("cancelled");
      try {
        return await this.runModel(input);
      } catch (error) {
        lastError = error;
        if (attempt + 1 < MAX_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(this.delayMs, 250 * 2 ** attempt)),
          );
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("OpenRouter request failed");
  }
}
