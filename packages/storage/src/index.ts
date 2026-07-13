import {
  automationPolicySchema,
  credentialMetadataSchema,
  type ExecutionRecord,
  type QuotaAutomationPolicy,
  type Subscription,
  type AIServicePreference,
  type CredentialMetadata,
  type ModelLabHistory,
  type ModelLabPreferences,
  subscriptionSchema,
  aiServicePreferenceSchema,
  modelLabSelectionSchema,
} from "@quotaloop/contracts";
export interface AppData {
  schemaVersion: 2;
  policy: QuotaAutomationPolicy;
  history: ExecutionRecord[];
  subscriptions: Subscription[];
  theme: "light" | "dark" | "system";
  onboardingComplete: boolean;
  notifications: NotificationPreferences;
  aiServices: AIServicePreference[];
  credentials: CredentialMetadata[];
  modelLab: ModelLabPreferences;
  modelLabHistory: ModelLabHistory[];
  lastNotificationEventKey: string | null;
}
export interface NotificationPreferences {
  webEnabled: boolean;
  desktopEnabled: boolean;
  actionCompleted: boolean;
  testNotification: boolean;
}
export function normalizeServicePreferences(
  preferences: AIServicePreference[],
): AIServicePreference[] {
  const seen = new Map<string, AIServicePreference>();
  for (const preference of preferences) {
    if (!seen.has(preference.serviceId))
      seen.set(preference.serviceId, preference);
    else
      seen.set(preference.serviceId, {
        serviceId: preference.serviceId,
        enabled: false,
        visibleInQuota: false,
        visibleInModelLab: false,
        allowCatalogAccess: false,
        allowBenchmarkRequests: false,
        favorite: false,
      });
  }
  return [...seen.values()];
}

export const APP_DATA_V1_KEY = "quotaloop.v1";
export const APP_DATA_V2_KEY = "quotaloop.v2";

export class LocalStorageRepository {
  constructor(
    private readonly legacyKey = APP_DATA_V1_KEY,
    private readonly key = APP_DATA_V2_KEY,
  ) {}

  load(fallback: AppData): AppData {
    try {
      const currentRaw = localStorage.getItem(this.key);
      if (currentRaw !== null) {
        return normalizeAppData(parseJson(currentRaw), fallback);
      }
      const legacyRaw = localStorage.getItem(this.legacyKey);
      if (legacyRaw === null) return fallback;
      const normalized = normalizeAppData(parseJson(legacyRaw), fallback);
      try {
        localStorage.setItem(this.key, JSON.stringify(normalized));
        localStorage.removeItem(this.legacyKey);
      } catch {
        // Keep v1 available when the normalized v2 write fails.
      }
      return normalized;
    } catch {
      return fallback;
    }
  }
  save(data: AppData) {
    localStorage.setItem(this.key, JSON.stringify(data));
  }
  clear() {
    localStorage.removeItem(this.key);
    localStorage.removeItem(this.legacyKey);
  }
  export(data: AppData) {
    return JSON.stringify(data, null, 2);
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function normalizeAppData(parsed: unknown, fallback: AppData): AppData {
  if (!parsed || typeof parsed !== "object") return fallback;
  const value = parsed as Record<string, unknown>;
  const policy = automationPolicySchema.safeParse(value.policy);
  const history = Array.isArray(value.history)
    ? value.history.filter(isExecutionRecord)
    : fallback.history;
  const subscriptions = Array.isArray(value.subscriptions)
    ? value.subscriptions.flatMap((item) => {
        const result = subscriptionSchema.safeParse(item);
        return result.success &&
          fallback.aiServices.some(
            (service) => service.serviceId === result.data.providerId,
          )
          ? [result.data]
          : [];
      })
    : fallback.subscriptions;
  const preferences =
    value.notifications && typeof value.notifications === "object"
      ? (value.notifications as Record<string, unknown>)
      : null;
  const notifications =
    preferences &&
    typeof preferences.webEnabled === "boolean" &&
    typeof preferences.desktopEnabled === "boolean" &&
    typeof preferences.actionCompleted === "boolean" &&
    typeof preferences.testNotification === "boolean"
      ? {
          webEnabled: preferences.webEnabled,
          desktopEnabled: preferences.desktopEnabled,
          actionCompleted: preferences.actionCompleted,
          testNotification: preferences.testNotification,
        }
      : fallback.notifications;
  const aiServices = Array.isArray(value.aiServices)
    ? normalizeServicePreferences(
        value.aiServices.flatMap((item) => {
          const result = aiServicePreferenceSchema.safeParse(item);
          return result.success &&
            fallback.aiServices.some(
              (service) => service.serviceId === result.data.serviceId,
            )
            ? [result.data]
            : [];
        }),
      )
    : fallback.aiServices;
  const credentials = Array.isArray(value.credentials)
    ? value.credentials.flatMap((item) => {
        const result = credentialMetadataSchema.safeParse(item);
        if (!result.success) return [];
        if (
          !fallback.aiServices.some(
            (service) => service.serviceId === result.data.providerId,
          )
        )
          return [];
        const { providerId, status, updatedAt } = result.data;
        return updatedAt === undefined
          ? [{ providerId, status }]
          : [{ providerId, status, updatedAt }];
      })
    : fallback.credentials;
  const modelLab = modelLabSelectionSchema.safeParse(value.modelLab);
  if (modelLab.success) {
    modelLab.data.selectedModelIds = modelLab.data.selectedModelIds.filter(
      (id) => /^demo-model-\d{2}$/.test(id),
    );
  }
  const modelLabHistory = Array.isArray(value.modelLabHistory)
    ? value.modelLabHistory.flatMap((item) =>
        isModelLabHistory(item) &&
        item.modelIds.every((id) => /^demo-model-\d{2}$/.test(id))
          ? [item]
          : [],
      )
    : fallback.modelLabHistory;
  return {
    ...fallback,
    schemaVersion: 2,
    policy: policy.success ? policy.data : fallback.policy,
    history,
    subscriptions,
    theme:
      value.theme === "light" ||
      value.theme === "dark" ||
      value.theme === "system"
        ? value.theme
        : fallback.theme,
    onboardingComplete:
      typeof value.onboardingComplete === "boolean"
        ? value.onboardingComplete
        : fallback.onboardingComplete,
    notifications,
    aiServices,
    credentials,
    modelLab: modelLab.success ? modelLab.data : fallback.modelLab,
    modelLabHistory,
    lastNotificationEventKey:
      typeof value.lastNotificationEventKey === "string"
        ? value.lastNotificationEventKey
        : fallback.lastNotificationEventKey,
  };
}
function isExecutionRecord(value: unknown): value is ExecutionRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    [
      "id",
      "providerId",
      "startedAt",
      "completedAt",
      "reason",
      "idempotencyKey",
    ].every((key) => typeof item[key] === "string") &&
    ["success", "blocked", "failed"].includes(String(item.outcome))
  );
}
function isModelLabHistory(value: unknown): value is ModelLabHistory {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.completedAt === "string" &&
    Array.isArray(item.modelIds) &&
    item.modelIds.every((id) => typeof id === "string") &&
    ["success", "failed"].includes(String(item.outcome)) &&
    Boolean(item.results && typeof item.results === "object") &&
    Object.values(item.results as Record<string, unknown>).every(
      (score) => typeof score === "number",
    )
  );
}
