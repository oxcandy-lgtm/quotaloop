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
  Object.keys(value).every((key) =>
    [
      "serviceId",
      "enabled",
      "visibleInQuota",
      "visibleInModelLab",
      "allowCatalogAccess",
      "allowBenchmarkRequests",
      "favorite",
    ].includes(key),
  ) &&
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
const isCredentialMetadata = (value: unknown) => {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).some(
      (key) => !["providerId", "status", "updatedAt"].includes(key),
    )
  )
    return false;
  return (
    typeof value.providerId === "string" &&
    ["not_configured", "configured", "unavailable"].includes(
      String(value.status),
    ) &&
    (value.updatedAt === undefined || typeof value.updatedAt === "string")
  );
};
const parsePreferences = (
  value: unknown,
  fallback: DesktopPersistentStateV2["preferences"],
) => {
  const source = isRecord(value) ? value : {};
  const notifications = isRecord(source.notifications)
    ? {
        enabled:
          typeof source.notifications.enabled === "boolean"
            ? source.notifications.enabled
            : fallback.notifications.enabled,
        actionCompleted:
          typeof source.notifications.actionCompleted === "boolean"
            ? source.notifications.actionCompleted
            : fallback.notifications.actionCompleted,
      }
    : fallback.notifications;
  return {
    theme:
      source.theme === "light" ||
      source.theme === "dark" ||
      source.theme === "system"
        ? source.theme
        : fallback.theme,
    aiServices: Array.isArray(source.aiServices)
      ? (source.aiServices.filter(
          isServicePreference,
        ) as DesktopPersistentStateV2["preferences"]["aiServices"])
      : fallback.aiServices,
    credentials: Array.isArray(source.credentials)
      ? (source.credentials.filter(
          isCredentialMetadata,
        ) as DesktopPersistentStateV2["preferences"]["credentials"])
      : fallback.credentials,
    notifications,
  };
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
    lastNotificationEventKey: null,
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
        executionHistory: Array.isArray(source.executionHistory)
          ? (source.executionHistory.filter(
              isExecutionRecord,
            ) as DesktopPersistentStateV2["executionHistory"])
          : fallback.executionHistory,
        modelLabPreferences:
          isRecord(source.modelLabPreferences) &&
          Array.isArray(source.modelLabPreferences.selectedModelIds) &&
          source.modelLabPreferences.selectedModelIds.every(
            (id) => typeof id === "string",
          )
            ? (source.modelLabPreferences as unknown as DesktopPersistentStateV2["modelLabPreferences"])
            : fallback.modelLabPreferences,
        modelLabHistory: Array.isArray(source.modelLabHistory)
          ? (source.modelLabHistory.filter(
              isModelLabHistory,
            ) as DesktopPersistentStateV2["modelLabHistory"])
          : fallback.modelLabHistory,
        subscriptions: Array.isArray(source.subscriptions)
          ? (source.subscriptions.filter(
              isSubscription,
            ) as DesktopPersistentStateV2["subscriptions"])
          : fallback.subscriptions,
        lastNotificationEventKey:
          typeof source.lastNotificationEventKey === "string"
            ? source.lastNotificationEventKey
            : null,
        preferences: parsePreferences(source.preferences, fallback.preferences),
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
const isModelLabHistory = (item: unknown) =>
  isRecord(item) &&
  typeof item.id === "string" &&
  Array.isArray(item.modelIds) &&
  item.modelIds.every((id) => typeof id === "string") &&
  typeof item.completedAt === "string" &&
  ["success", "failed"].includes(String(item.outcome)) &&
  isRecord(item.results) &&
  Object.values(item.results).every((score) => typeof score === "number");
