import type {
  OpenRouterBenchmarkManifest,
  OpenRouterBenchmarkResult,
  OpenRouterBenchmarkRunState,
  OpenRouterCatalogSnapshot,
} from "@quotaloop/contracts";

export type OpenRouterRunErrorCode = NonNullable<
  OpenRouterBenchmarkResult["errorCode"]
>;

/** A typed, UI-safe error used to control queue retry and resume behavior. */
export class OpenRouterRunError extends Error {
  constructor(
    message: string,
    readonly code: OpenRouterRunErrorCode,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "OpenRouterRunError";
  }
}

export type OpenRouterModelRunner = (input: {
  modelId: string;
  runId: string;
  manifest: OpenRouterBenchmarkManifest;
  catalogHash?: string;
  eligibleModelIds?: string[];
}) => Promise<OpenRouterBenchmarkResult>;

export interface OpenRouterRunnerStore {
  load(): OpenRouterBenchmarkRunState;
  save(state: OpenRouterBenchmarkRunState): void;
}

const now = () => new Date().toISOString();
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 60_000;
const RETRYABLE_CODES = new Set<OpenRouterRunErrorCode>([
  "rate_limited",
  "server_error",
  "timeout",
]);

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const classifyError = (error: unknown): OpenRouterRunError => {
  if (error instanceof OpenRouterRunError) return error;
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error);
  const lower = message.toLocaleLowerCase();
  const explicitCode =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : null;
  const knownCodes: OpenRouterRunErrorCode[] = [
    "unauthorized",
    "forbidden",
    "payment_required",
    "rate_limited",
    "server_error",
    "timeout",
    "cancelled",
    "model_mismatch",
    "invalid_response",
  ];
  const code: OpenRouterRunErrorCode = knownCodes.includes(
    explicitCode as OpenRouterRunErrorCode,
  )
    ? (explicitCode as OpenRouterRunErrorCode)
    : /cancel/i.test(lower)
      ? "cancelled"
      : /429|rate.?limit|too many/i.test(lower)
        ? "rate_limited"
        : /401|auth|unauthorized/i.test(lower)
          ? "unauthorized"
          : /403|forbidden|denied/i.test(lower)
            ? "forbidden"
            : /402|payment|credit/i.test(lower)
              ? "payment_required"
              : /timeout|timed out|deadline/i.test(lower)
                ? "timeout"
                : /5\d\d|server/i.test(lower)
                  ? "server_error"
                  : /mismatch/i.test(lower)
                    ? "model_mismatch"
                    : "invalid_response";
  const retryAfter =
    error && typeof error === "object" && "retryAfterMs" in error
      ? (error as { retryAfterMs?: unknown }).retryAfterMs
      : null;
  const retryAfterFromMessage = /retry-after-ms=(\d+)/i.exec(message)?.[1];
  return new OpenRouterRunError(
    message || "OpenRouter request failed",
    code,
    typeof retryAfter === "number" && Number.isFinite(retryAfter)
      ? Math.max(0, Math.min(MAX_RETRY_AFTER_MS, retryAfter))
      : retryAfterFromMessage
        ? Math.max(
            0,
            Math.min(MAX_RETRY_AFTER_MS, Number(retryAfterFromMessage)),
          )
        : null,
  );
};

const unique = (items: string[]) => [...new Set(items)];

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
        pausedReason: "interrupted",
        retryAfterMs: null,
        updatedAt: now(),
      };
      this.persist();
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
    const ids = unique(
      (requestedIds?.length
        ? requestedIds
        : catalog.eligibleModels.map((model) => model.id)
      ).filter((id) => catalog.eligibleModels.some((model) => model.id === id)),
    );
    if (!ids.length) return false;
    const runId = crypto.randomUUID();
    const sameQueue =
      this.state.catalogHash === catalog.catalogHash &&
      Boolean(this.state.runId) &&
      (this.state.status === "paused" || this.state.status === "interrupted");
    const completed = sameQueue
      ? this.state.completedModelIds.filter((id) => ids.includes(id))
      : [];
    const failed = sameQueue
      ? (this.state.failedModelIds ?? []).filter((id) => ids.includes(id))
      : [];
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.state = {
      runId,
      status: "running",
      mode: "live",
      modelIds: ids,
      completedModelIds: completed,
      failedModelIds: failed,
      currentModelId: null,
      progress: Math.round(
        ((completed.length + failed.length) / ids.length) * 100,
      ),
      startedAt: now(),
      updatedAt: now(),
      catalogHash: catalog.catalogHash,
      manifestHash: this.manifest.manifestHash,
      concurrency: 1,
      delayMs: 3200,
      pausedReason: undefined,
      retryAfterMs: null,
      lastErrorCode: undefined,
    };
    this.persist();
    this.startExecution(catalog);
    return true;
  }

  pause() {
    if (this.state.status !== "running") return false;
    this.pauseRequested = true;
    this.state = {
      ...this.state,
      status: "paused",
      pausedReason: "user",
      retryAfterMs: null,
      updatedAt: now(),
    };
    this.persist();
    return true;
  }

  /** Resume the persisted queue, including after a desktop restart. */
  resume(catalog?: OpenRouterCatalogSnapshot) {
    if (this.state.status !== "paused" && this.state.status !== "interrupted")
      return false;
    if (this.currentPromise) {
      this.pauseRequested = false;
      this.state = {
        ...this.state,
        status: "running",
        pausedReason: undefined,
        retryAfterMs: null,
        updatedAt: now(),
      };
      this.persist();
      return true;
    }
    if (
      !catalog ||
      !this.state.catalogHash ||
      catalog.catalogHash !== this.state.catalogHash
    )
      return false;
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.state = {
      ...this.state,
      status: "running",
      pausedReason: undefined,
      retryAfterMs: null,
      currentModelId: null,
      updatedAt: now(),
    };
    this.persist();
    this.startExecution(catalog);
    return true;
  }

  cancel() {
    if (
      !this.currentPromise &&
      this.state.status !== "running" &&
      this.state.status !== "paused" &&
      this.state.status !== "interrupted"
    )
      return false;
    this.cancelRequested = true;
    this.pauseRequested = false;
    this.state = {
      ...this.state,
      status: "cancelled",
      currentModelId: null,
      pausedReason: undefined,
      retryAfterMs: null,
      updatedAt: now(),
    };
    this.persist();
    return true;
  }

  private startExecution(catalog: OpenRouterCatalogSnapshot) {
    this.currentPromise = this.execute(catalog).finally(() => {
      this.currentPromise = null;
    });
  }

  private persist() {
    this.store.save(this.state);
    this.onState?.(this.state);
  }

  private finishedCount() {
    return (
      this.state.completedModelIds.length +
      (this.state.failedModelIds ?? []).length
    );
  }

  private async execute(catalog: OpenRouterCatalogSnapshot) {
    const ids = this.state.modelIds;
    for (const modelId of ids) {
      if (this.cancelRequested) break;
      while (this.pauseRequested && !this.cancelRequested) await sleep(50);
      if (this.cancelRequested) break;
      if (
        this.state.completedModelIds.includes(modelId) ||
        (this.state.failedModelIds ?? []).includes(modelId)
      )
        continue;

      this.state = { ...this.state, currentModelId: modelId, updatedAt: now() };
      this.persist();
      try {
        const modelInput: Parameters<OpenRouterModelRunner>[0] = {
          modelId,
          runId: this.state.runId!,
          manifest: this.manifest,
          eligibleModelIds: catalog.eligibleModels.map((model) => model.id),
        };
        if (this.state.catalogHash)
          modelInput.catalogHash = this.state.catalogHash;
        const result = await this.runModelWithRetry(modelInput);
        if (!this.cancelRequested) this.onResult(result);
        if (result.outcome === "success" && !this.cancelRequested) {
          this.state = {
            ...this.state,
            completedModelIds: unique([
              ...this.state.completedModelIds,
              modelId,
            ]),
            progress: Math.round(
              ((this.finishedCount() + 1) / ids.length) * 100,
            ),
            currentModelId: null,
            updatedAt: now(),
          };
        } else if (!this.cancelRequested) {
          const errorCode = result.errorCode ?? "invalid_response";
          this.state = {
            ...this.state,
            failedModelIds: unique([
              ...(this.state.failedModelIds ?? []),
              modelId,
            ]),
            lastErrorCode: errorCode,
            progress: Math.round(
              ((this.finishedCount() + 1) / ids.length) * 100,
            ),
            currentModelId: null,
            updatedAt: now(),
          };
        }
        this.persist();
      } catch (error) {
        const typed = classifyError(error);
        if (typed.code === "cancelled" || this.cancelRequested) break;
        if (typed.code === "rate_limited") {
          this.pauseRequested = true;
          this.state = {
            ...this.state,
            status: "paused",
            pausedReason: "rate_limited",
            retryAfterMs: typed.retryAfterMs,
            currentModelId: null,
            lastErrorCode: typed.code,
            updatedAt: now(),
          };
          this.persist();
          return;
        }
        // A model failure is recorded and the queue advances. One bad model
        // must never prevent the remaining selected models from running.
        const failure: OpenRouterBenchmarkResult = {
          id: `${this.state.runId}:${modelId}`,
          modelId,
          modelName: modelId,
          manifestId: this.manifest.manifestId,
          catalogHash: this.state.catalogHash ?? "",
          completedAt: now(),
          outcome: "failed",
          errorCode: typed.code,
          metrics: null,
          caseScores: [],
        };
        this.onResult(failure);
        this.state = {
          ...this.state,
          failedModelIds: unique([
            ...(this.state.failedModelIds ?? []),
            modelId,
          ]),
          lastErrorCode: typed.code,
          progress: Math.round(((this.finishedCount() + 1) / ids.length) * 100),
          currentModelId: null,
          updatedAt: now(),
        };
        this.persist();
      }
      if (this.cancelRequested || this.pauseRequested) continue;
      if (this.finishedCount() < ids.length) await sleep(this.delayMs);
    }
    if (this.state.status === "paused" || this.state.status === "cancelled")
      return;
    this.state = {
      ...this.state,
      status: this.cancelRequested ? "cancelled" : "completed",
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
    eligibleModelIds?: string[];
  }) {
    let lastError: OpenRouterRunError | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      if (this.cancelRequested)
        throw new OpenRouterRunError("cancelled", "cancelled");
      try {
        return await this.runModel(input);
      } catch (error) {
        lastError = classifyError(error);
        if (!RETRYABLE_CODES.has(lastError.code) || attempt + 1 >= MAX_RETRIES)
          break;
        const exponential = Math.min(this.delayMs, 250 * 2 ** attempt);
        const waitMs = Math.min(
          MAX_RETRY_AFTER_MS,
          lastError.retryAfterMs ?? exponential,
        );
        await sleep(waitMs);
      }
    }
    throw (
      lastError ??
      new OpenRouterRunError("OpenRouter request failed", "invalid_response")
    );
  }
}
