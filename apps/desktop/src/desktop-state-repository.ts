import type { DesktopPersistentStateV2 } from "@quotaloop/contracts";
import { automationPolicySchema } from "@quotaloop/contracts";
import { safeDefaultPolicy } from "./automation-controller";

const KEY = "quotaloop.desktop.v2";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const isExecutionRecord = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    [
      "id",
      "providerId",
      "startedAt",
      "completedAt",
      "reason",
      "idempotencyKey",
    ].every((key) => typeof value[key] === "string") &&
    ["success", "blocked", "failed"].includes(String(value.outcome))
  );
};
const isSubscription = (value: unknown) => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.providerId === "string" &&
    typeof value.plan === "string" &&
    typeof value.monthlyPrice === "number" &&
    typeof value.currency === "string" &&
    typeof value.renewalDate === "string" &&
    typeof value.autoRenew === "boolean" &&
    typeof value.notes === "string"
  );
};
const isServicePreference = (value: unknown) =>
  isRecord(value) &&
  [
    "serviceId",
    "enabled",
    "visibleInQuota",
    "visibleInModelLab",
    "allowCatalogAccess",
    "allowBenchmarkRequests",
    "favorite",
  ].every(
    (key) => typeof value[key] === (key === "serviceId" ? "string" : "boolean"),
  );
const isPreferences = (value: unknown) => {
  if (
    !isRecord(value) ||
    !["light", "dark", "system"].includes(String(value.theme))
  )
    return false;
  if (
    !Array.isArray(value.aiServices) ||
    !value.aiServices.every(isServicePreference)
  )
    return false;
  if (
    !Array.isArray(value.credentials) ||
    !value.credentials.every(
      (c) =>
        isRecord(c) &&
        typeof c.providerId === "string" &&
        ["not_configured", "configured", "unavailable"].includes(
          String(c.status),
        ),
    )
  )
    return false;
  return (
    isRecord(value.notifications) &&
    typeof value.notifications.enabled === "boolean" &&
    typeof value.notifications.actionCompleted === "boolean"
  );
};
export function defaultDesktopState(): DesktopPersistentStateV2 {
  return {
    schemaVersion: 2,
    preferences: {
      theme: "system",
      aiServices: [],
      credentials: [],
      notifications: { enabled: false, actionCompleted: true },
    },
    automationPolicy: safeDefaultPolicy(),
    executionHistory: [],
    modelLabPreferences: { selectedModelIds: [] },
    modelLabHistory: [],
    subscriptions: [],
  };
}
export class DesktopStateRepository {
  load(): DesktopPersistentStateV2 {
    const fallback = defaultDesktopState();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fallback;
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object") return fallback;
      const source = value as Record<string, unknown>;
      return {
        ...fallback,
        schemaVersion: 2,
        automationPolicy: automationPolicySchema.safeParse(
          source.automationPolicy,
        ).success
          ? automationPolicySchema.parse(source.automationPolicy)
          : fallback.automationPolicy,
        executionHistory:
          Array.isArray(source.executionHistory) &&
          source.executionHistory.every(isExecutionRecord)
            ? (source.executionHistory as DesktopPersistentStateV2["executionHistory"])
            : fallback.executionHistory,
        modelLabPreferences:
          isRecord(source.modelLabPreferences) &&
          Array.isArray(source.modelLabPreferences.selectedModelIds) &&
          source.modelLabPreferences.selectedModelIds.every(
            (id) => typeof id === "string",
          )
            ? (source.modelLabPreferences as unknown as DesktopPersistentStateV2["modelLabPreferences"])
            : fallback.modelLabPreferences,
        modelLabHistory:
          Array.isArray(source.modelLabHistory) &&
          source.modelLabHistory.every(
            (item) =>
              isRecord(item) &&
              typeof item.id === "string" &&
              Array.isArray(item.modelIds) &&
              item.modelIds.every((id) => typeof id === "string") &&
              typeof item.completedAt === "string" &&
              ["success", "failed"].includes(String(item.outcome)) &&
              isRecord(item.results) &&
              Object.values(item.results).every(
                (score) => typeof score === "number",
              ),
          )
            ? (source.modelLabHistory as DesktopPersistentStateV2["modelLabHistory"])
            : fallback.modelLabHistory,
        subscriptions:
          Array.isArray(source.subscriptions) &&
          source.subscriptions.every(isSubscription)
            ? (source.subscriptions as DesktopPersistentStateV2["subscriptions"])
            : fallback.subscriptions,
        preferences: isPreferences(source.preferences)
          ? (source.preferences as DesktopPersistentStateV2["preferences"])
          : fallback.preferences,
      };
    } catch {
      return fallback;
    }
  }
  save(state: DesktopPersistentStateV2) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  clear() {
    localStorage.removeItem(KEY);
  }
}
