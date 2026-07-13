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
export class LocalStorageRepository {
  constructor(private readonly key = "quotaloop.v1") {}
  load(fallback: AppData): AppData {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return fallback;
      const value = JSON.parse(raw) as AppData;
      return {
        ...fallback,
        ...value,
        schemaVersion: 2,
        policy: automationPolicySchema.parse(value.policy),
        aiServices: Array.isArray(value.aiServices)
          ? normalizeServicePreferences(value.aiServices)
          : fallback.aiServices,
        credentials: Array.isArray(value.credentials)
          ? value.credentials.flatMap((item) => {
              const parsed = credentialMetadataSchema.safeParse(item);
              if (!parsed.success) return [];
              const { providerId, status, updatedAt } = parsed.data;
              return [
                updatedAt
                  ? { providerId, status, updatedAt }
                  : { providerId, status },
              ];
            })
          : fallback.credentials,
        modelLab: value.modelLab ?? fallback.modelLab,
        modelLabHistory: Array.isArray(value.modelLabHistory)
          ? value.modelLabHistory
          : fallback.modelLabHistory,
      };
    } catch {
      return fallback;
    }
  }
  save(data: AppData) {
    localStorage.setItem(this.key, JSON.stringify(data));
  }
  clear() {
    localStorage.removeItem(this.key);
  }
  export(data: AppData) {
    return JSON.stringify(data, null, 2);
  }
}
