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
  activeHours: z.object({
    start: z.string(),
    end: z.string(),
    timeZone: z.string(),
  }),
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

export interface AIServiceDefinition {
  serviceId: string;
  displayName: string;
  integrationLevel: IntegrationLevel;
  capabilities: ProviderCapabilities;
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

export interface ModelLabPreferences {
  selectedModelIds: string[];
}

export interface ModelLabHistory {
  id: string;
  modelIds: string[];
  completedAt: string;
  outcome: "success" | "failed";
  results: Record<string, number>;
}
