import { z } from "zod";

export type IntegrationLevel =
  | "full"
  | "quota_read"
  | "run_only"
  | "detect_only"
  | "manual"
  | "mock"
  | "unsupported";
export type ProviderState =
  | "ready"
  | "quota_low"
  | "limit_reached"
  | "login_expired"
  | "not_installed"
  | "unsupported"
  | "manual"
  | "unavailable"
  | "mock"
  | "stale";
export type DataOrigin = "local_cli" | "manual" | "mock";

export interface ProviderCapabilities {
  installationDetection: boolean;
  authenticationDetection: boolean;
  quotaRead: boolean;
  resetTimeRead: boolean;
  localTaskExecution: boolean;
  nativeNotificationMetadata: boolean;
}

export const quotaStatusSchema = z.object({
  providerId: z.string().min(1),
  state: z.enum([
    "ready",
    "quota_low",
    "limit_reached",
    "login_expired",
    "not_installed",
    "unsupported",
    "manual",
    "unavailable",
    "mock",
    "stale",
  ]),
  origin: z.enum(["local_cli", "manual", "mock"]),
  sessionRemainingPercent: z.number().min(0).max(100).nullable(),
  weeklyRemainingPercent: z.number().min(0).max(100).nullable(),
  resetsAt: z.string().datetime().nullable(),
  observedAt: z.string().datetime(),
  staleAfter: z.string().datetime(),
});
export type QuotaStatus = z.infer<typeof quotaStatusSchema>;

export interface QuotaProvider {
  readonly id: string;
  readonly displayName: string;
  readonly integrationLevel: IntegrationLevel;
  readonly capabilities: ProviderCapabilities;
  detectInstallation(): Promise<{ installed: boolean; version: string | null }>;
  getAuthStatus(): Promise<{ authenticated: boolean | null }>;
  getQuotaStatus(): Promise<QuotaStatus>;
  runAction?(options: ProviderActionOptions): Promise<ProviderActionResult>;
}

export interface ProviderActionOptions {
  mode: "minimal" | "utility";
  idempotencyKey: string;
  timeoutMs: number;
}
export interface ProviderActionResult {
  ok: boolean;
  providerId: string;
  completedAt: string;
  summary: string;
}

export const automationPolicySchema = z.object({
  enabled: z.boolean().default(false),
  paused: z.boolean().default(false),
  actionMode: z.enum(["minimal", "utility"]).default("minimal"),
  maximumRunsPerDay: z.number().int().min(1).max(10).default(2),
  minimumRemainingPercent: z.number().min(0).max(100).nullable().default(40),
  activeHours: z
    .object({
      start: z.string(),
      end: z.string(),
      timeZone: z.string(),
    })
    .strict(),
  targetProviders: z.array(z.string()),
});
export type QuotaAutomationPolicy = z.infer<typeof automationPolicySchema>;

export interface ExecutionRecord {
  id: string;
  providerId: string;
  startedAt: string;
  completedAt: string;
  outcome: "success" | "blocked" | "failed";
  reason: string;
  idempotencyKey: string;
}
export interface ResetSignal {
  id: string;
  providerId: string;
  confidence: "confirmed" | "likely" | "watch";
  eventType: string;
  sourceTier: "official" | "product" | "community";
  summary: string;
  sourceUrl: string;
  publishedAt: string;
  observedAt: string;
}
export interface Subscription {
  id: string;
  providerId: string;
  plan: string;
  monthlyPrice: number;
  currency: string;
  renewalDate: string;
  autoRenew: boolean;
  notes: string;
}
export type SubscriptionMutation =
  | { operation: "add"; subscription: Subscription }
  | { operation: "update"; subscription: Subscription }
  | { operation: "remove"; subscriptionId: string };
export const subscriptionSchema = z
  .object({
    id: z.string().min(1),
    providerId: z.string().min(1),
    plan: z.string().min(1),
    monthlyPrice: z.number().finite().min(0),
    currency: z.string().min(1).max(8),
    renewalDate: z.string().min(1),
    autoRenew: z.boolean(),
    notes: z.string(),
  })
  .strict();
export const subscriptionMutationSchema = z.discriminatedUnion("operation", [
  z
    .object({ operation: z.literal("add"), subscription: subscriptionSchema })
    .strict(),
  z
    .object({
      operation: z.literal("update"),
      subscription: subscriptionSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("remove"),
      subscriptionId: z.string().min(1),
    })
    .strict(),
]);

export interface AIServiceDefinition {
  serviceId: string;
  displayName: string;
  integrationLevel: IntegrationLevel;
  supportsQuotaSurface: boolean;
  supportsQuotaRead: boolean;
  supportsModelLab: boolean;
  supportsCatalog: boolean;
  supportsBenchmark: boolean;
  credentialMode: "none" | "local_session" | "api_key" | "unavailable";
  capabilities?: ProviderCapabilities;
}

export interface AIServicePreference {
  serviceId: string;
  enabled: boolean;
  visibleInQuota: boolean;
  visibleInModelLab: boolean;
  allowCatalogAccess: boolean;
  allowBenchmarkRequests: boolean;
  favorite: boolean;
}

export interface CredentialMetadata {
  providerId: string;
  status: "not_configured" | "configured" | "unavailable";
  updatedAt?: string;
}
export const credentialMetadataSchema = z
  .object({
    providerId: z.string().min(1),
    status: z.enum(["not_configured", "configured", "unavailable"]),
    updatedAt: z.string().datetime().optional(),
  })
  .strict();

export interface ModelLabPreferences {
  selectedModelIds: string[];
}
export const modelLabSelectionSchema = z
  .object({ selectedModelIds: z.array(z.string().min(1)).max(100) })
  .strict();

export interface ModelLabHistory {
  id: string;
  modelIds: string[];
  completedAt: string;
  outcome: "success" | "failed";
  results: Record<string, number>;
}

/** A bounded, secret-free snapshot of the OpenRouter free catalog. */
export interface OpenRouterModel {
  id: string;
  name: string;
  canonicalSlug: string;
  created: number | null;
  contextLength: number | null;
  promptPrice: string;
  completionPrice: string;
  isFree: boolean;
  isRouterAlias: boolean;
  supportsStreaming: boolean;
}
export interface OpenRouterExcludedModel {
  id: string;
  reason: "paid" | "router_alias" | "missing_id" | "malformed" | "unsupported";
}
export interface OpenRouterCatalogSnapshot {
  schemaVersion: 1;
  fetchedAt: string;
  catalogHash: string;
  eligibleModels: OpenRouterModel[];
  excludedModels: OpenRouterExcludedModel[];
}
export type OpenRouterBenchmarkCaseKind = "japanese" | "english" | "coding";
export interface OpenRouterBenchmarkCase {
  id: string;
  kind: OpenRouterBenchmarkCaseKind;
  language: "ja" | "en";
  prompt: string;
  expectedAnswer: string;
  expectedTokens?: string[];
}
export interface OpenRouterBenchmarkManifest {
  manifestId: "quotaloop.openrouter.free-benchmark.v1";
  manifestHash: string;
  promptHash: string;
  systemPrompt: string;
  cases: OpenRouterBenchmarkCase[];
}
export interface OpenRouterBenchmarkMetrics {
  correctness: number;
  instructionFollowing: number;
  trackScores: {
    japanese: number;
    english: number;
    coding: number;
  };
  caseCount: number;
  ttftMs: number | null;
  totalLatencyMs: number | null;
  throughputTokensPerSecond: number | null;
  tokenUsage: {
    prompt: number | null;
    completion: number | null;
    total: number | null;
  };
  overallScore: number;
}
export interface OpenRouterBenchmarkResult {
  id: string;
  modelId: string;
  modelName: string;
  manifestId: string;
  catalogHash: string;
  completedAt: string;
  outcome: "success" | "failed" | "cancelled" | "mismatch";
  errorCode?:
    | "unauthorized"
    | "forbidden"
    | "payment_required"
    | "rate_limited"
    | "server_error"
    | "timeout"
    | "cancelled"
    | "model_mismatch"
    | "invalid_response";
  metrics: OpenRouterBenchmarkMetrics | null;
  caseScores: Array<{ caseId: string; score: number; passed: boolean }>;
}
export type OpenRouterRunStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface OpenRouterBenchmarkRunState {
  runId: string | null;
  status: OpenRouterRunStatus;
  mode: "live";
  modelIds: string[];
  completedModelIds: string[];
  failedModelIds?: string[];
  currentModelId: string | null;
  progress: number;
  startedAt: string | null;
  updatedAt: string | null;
  catalogHash: string | null;
  manifestHash: string;
  concurrency: 1;
  delayMs: 3200;
  pausedReason?: "user" | "rate_limited" | "interrupted" | undefined;
  retryAfterMs?: number | null | undefined;
  lastErrorCode?: OpenRouterBenchmarkResult["errorCode"] | undefined;
}
export interface OpenRouterPersistentState {
  catalog: OpenRouterCatalogSnapshot | null;
  benchmarkRun: OpenRouterBenchmarkRunState;
  benchmarkResults: OpenRouterBenchmarkResult[];
}
export interface OpenRouterKeyStatus {
  configured: boolean;
  source: "keychain" | "environment" | "none";
  lastFour: string | null;
}
export const emptyOpenRouterPersistentState =
  (): OpenRouterPersistentState => ({
    catalog: null,
    benchmarkRun: {
      runId: null,
      status: "idle",
      mode: "live",
      modelIds: [],
      completedModelIds: [],
      failedModelIds: [],
      currentModelId: null,
      progress: 0,
      startedAt: null,
      updatedAt: null,
      catalogHash: null,
      manifestHash: "",
      concurrency: 1,
      delayMs: 3200,
      pausedReason: undefined,
      retryAfterMs: null,
      lastErrorCode: undefined,
    },
    benchmarkResults: [],
  });

export type DashboardSection =
  | "overview"
  | "providers"
  | "model_lab"
  | "automation"
  | "history"
  | "signals"
  | "subscriptions"
  | "settings";
export type ProviderDetectionState =
  | "installed"
  | "not_installed"
  | "timeout"
  | "failed"
  | "unsupported"
  | "not_checked";
export type NotificationPermissionState =
  "unknown" | "granted" | "denied" | "unavailable";
export interface SharedUserPreferencesV2 {
  theme: "light" | "dark" | "system";
  aiServices: AIServicePreference[];
  credentials: CredentialMetadata[];
  notifications: { enabled: boolean; actionCompleted: boolean };
}
export interface DesktopPersistentStateV2 {
  schemaVersion: 2;
  preferences: SharedUserPreferencesV2;
  automationPolicy: QuotaAutomationPolicy;
  executionHistory: ExecutionRecord[];
  modelLabPreferences: ModelLabPreferences;
  modelLabHistory: ModelLabHistory[];
  subscriptions: Subscription[];
  lastNotificationEventKey: string | null;
  openrouter: OpenRouterPersistentState;
}
export interface ModelLabRunState {
  status: "idle" | "running" | "completed" | "failed";
  progress: number;
  runId: string | null;
}
export interface DesktopRuntimeSnapshotV2 {
  schemaVersion: 2;
  revision: number;
  hydrated: boolean;
  persistent: DesktopPersistentStateV2;
  providerStates: Array<{
    providerId: string;
    state: ProviderDetectionState;
    version?: string | null;
  }>;
  modelLabRunState: ModelLabRunState;
  notificationPermission: NotificationPermissionState;
  openrouter: OpenRouterPersistentState;
}
export type DesktopRequestType =
  | "desktop_snapshot_requested"
  | "refresh_providers_requested"
  | "automation_policy_requested"
  | "model_lab_run_requested"
  | "model_lab_selection_requested"
  | "service_preference_requested"
  | "notification_preference_requested"
  | "subscription_requested"
  | "clear_local_data_requested"
  | "manual_action_requested"
  | "openrouter_catalog_refresh_requested"
  | "openrouter_benchmark_requested"
  | "openrouter_benchmark_pause_requested"
  | "openrouter_benchmark_resume_requested"
  | "openrouter_benchmark_cancel_requested";
export const aiServicePreferenceSchema = z
  .object({
    serviceId: z.string().min(1),
    enabled: z.boolean(),
    visibleInQuota: z.boolean(),
    visibleInModelLab: z.boolean(),
    allowCatalogAccess: z.boolean(),
    allowBenchmarkRequests: z.boolean(),
    favorite: z.boolean(),
  })
  .strict();
export const notificationPreferenceSchema = z
  .object({ enabled: z.boolean(), actionCompleted: z.boolean() })
  .strict();
export const desktopRequestPayloadSchemas = {
  desktop_snapshot_requested: z.object({}).strict(),
  refresh_providers_requested: z.object({}).strict(),
  automation_policy_requested: automationPolicySchema.strict(),
  model_lab_run_requested: z.object({}).strict(),
  model_lab_selection_requested: modelLabSelectionSchema,
  service_preference_requested: aiServicePreferenceSchema,
  notification_preference_requested: notificationPreferenceSchema,
  subscription_requested: subscriptionMutationSchema,
  clear_local_data_requested: z.object({}).strict(),
  manual_action_requested: z.object({}).strict(),
  openrouter_catalog_refresh_requested: z.object({}).strict(),
  openrouter_benchmark_requested: z
    .object({
      modelIds: z.array(z.string().min(1)).max(100),
      catalogHash: z.string().min(1),
    })
    .strict(),
  openrouter_benchmark_pause_requested: z.object({}).strict(),
  openrouter_benchmark_resume_requested: z.object({}).strict(),
  openrouter_benchmark_cancel_requested: z.object({}).strict(),
};
export const desktopRequestEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    requestId: z.string().uuid(),
    type: z.enum([
      "desktop_snapshot_requested",
      "refresh_providers_requested",
      "automation_policy_requested",
      "model_lab_run_requested",
      "model_lab_selection_requested",
      "service_preference_requested",
      "notification_preference_requested",
      "subscription_requested",
      "clear_local_data_requested",
      "manual_action_requested",
      "openrouter_catalog_refresh_requested",
      "openrouter_benchmark_requested",
      "openrouter_benchmark_pause_requested",
      "openrouter_benchmark_resume_requested",
      "openrouter_benchmark_cancel_requested",
    ]),
    payload: z.unknown(),
  })
  .strict();
export interface DesktopRequestEnvelope<T = unknown> {
  schemaVersion: 2;
  requestId: string;
  type: DesktopRequestType;
  payload: T;
}
export interface DesktopRequestResult {
  requestId: string;
  accepted: boolean;
  revision: number;
  reason?: string;
}
