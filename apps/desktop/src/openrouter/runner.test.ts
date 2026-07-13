import { describe, expect, it } from "vitest";
import { OPENROUTER_BENCHMARK_MANIFEST } from "./benchmark-manifest";
import {
  OpenRouterBenchmarkRunner,
  type OpenRouterRunnerStore,
} from "./runner";
import type {
  OpenRouterBenchmarkResult,
  OpenRouterBenchmarkRunState,
  OpenRouterCatalogSnapshot,
} from "@quotaloop/contracts";

const catalog: OpenRouterCatalogSnapshot = {
  schemaVersion: 1,
  fetchedAt: "2030-01-01T00:00:00.000Z",
  catalogHash: "catalog-1",
  eligibleModels: [
    {
      id: "a/model:free",
      name: "A",
      canonicalSlug: "a/model:free",
      created: null,
      contextLength: null,
      promptPrice: "0",
      completionPrice: "0",
      isFree: true,
      isRouterAlias: false,
      supportsStreaming: true,
    },
    {
      id: "b/model:free",
      name: "B",
      canonicalSlug: "b/model:free",
      created: null,
      contextLength: null,
      promptPrice: "0",
      completionPrice: "0",
      isFree: true,
      isRouterAlias: false,
      supportsStreaming: true,
    },
  ],
  excludedModels: [],
};

class Store implements OpenRouterRunnerStore {
  constructor(private state: OpenRouterBenchmarkRunState) {}
  load() {
    return this.state;
  }
  save(state: OpenRouterBenchmarkRunState) {
    this.state = state;
  }
}

const result = (modelId: string): OpenRouterBenchmarkResult => ({
  id: `run-${modelId}`,
  modelId,
  modelName: modelId,
  manifestId: OPENROUTER_BENCHMARK_MANIFEST.manifestId,
  catalogHash: catalog.catalogHash,
  completedAt: new Date().toISOString(),
  outcome: "success",
  metrics: null,
  caseScores: [],
});

describe("OpenRouter single runner", () => {
  it("runs at most once and prevents duplicate completed models", async () => {
    const store = new Store({
      runId: null,
      status: "idle",
      mode: "live",
      modelIds: [],
      completedModelIds: [],
      currentModelId: null,
      progress: 0,
      startedAt: null,
      updatedAt: null,
      catalogHash: null,
      manifestHash: "",
      concurrency: 1,
      delayMs: 3200,
    });
    const results: string[] = [];
    const runner = new OpenRouterBenchmarkRunner(
      OPENROUTER_BENCHMARK_MANIFEST,
      store,
      async ({ modelId }) => result(modelId),
      (item) => results.push(item.modelId),
      0,
    );
    expect(runner.runAllFreeModels(catalog)).toBe(true);
    expect(runner.runAllFreeModels(catalog)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(results).toEqual(["a/model:free", "b/model:free"]);
    expect(runner.getSnapshot().status).toBe("completed");
    expect(runner.getSnapshot().completedModelIds).toHaveLength(2);
  });
  it("marks a persisted running state interrupted on restart", () => {
    const store = new Store({
      runId: "old",
      status: "running",
      mode: "live",
      modelIds: ["a/model:free"],
      completedModelIds: [],
      currentModelId: "a/model:free",
      progress: 0,
      startedAt: "2030-01-01T00:00:00.000Z",
      updatedAt: null,
      catalogHash: catalog.catalogHash,
      manifestHash: OPENROUTER_BENCHMARK_MANIFEST.manifestHash,
      concurrency: 1,
      delayMs: 3200,
    });
    const runner = new OpenRouterBenchmarkRunner(
      OPENROUTER_BENCHMARK_MANIFEST,
      store,
      async ({ modelId }) => result(modelId),
      () => undefined,
      0,
    );
    expect(runner.getSnapshot().status).toBe("interrupted");
  });
});
