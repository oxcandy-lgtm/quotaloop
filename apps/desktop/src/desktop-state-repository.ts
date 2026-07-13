import type {
  DesktopPersistentStateV2,
  OpenRouterPersistentState,
} from "@quotaloop/contracts";
import {
  automationPolicySchema,
  emptyOpenRouterPersistentState,
  modelLabSelectionSchema,
} from "@quotaloop/contracts";
import { safeDefaultPolicy } from "./automation-controller";

export const DESKTOP_STATE_KEY = "quotaloop.desktop.v2";
export const LEGACY_DESKTOP_KEYS = {
  policy: "quotaloop.desktop.policy",
  history: "quotaloop.desktop.history",
  notifications: "quotaloop.desktop.notifications",
  aiServices: "quotaloop.desktop.ai-services",
  modelLab: "quotaloop.desktop.model-lab",
  lastNotificationEvent: "quotaloop.desktop.last-notification-event",
} as const;
const legacyKeys = Object.values(LEGACY_DESKTOP_KEYS);

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

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseLegacyNotificationPreferences(
  value: unknown,
  fallback: DesktopPersistentStateV2["preferences"]["notifications"],
) {
  return parsePreferences(
    { notifications: value },
    {
      theme: "system",
      aiServices: [],
      credentials: [],
      notifications: fallback,
    },
  ).notifications;
}

function parseLegacyEventKey(raw: string | null): string | null {
  if (raw === null) return null;
  const parsed = parseJson(raw);
  if (typeof parsed === "string") return parsed || null;
  if (parsed === undefined) return raw || null;
  return null;
}

function parseModelLabSelection(value: unknown) {
  const direct = modelLabSelectionSchema.safeParse(value);
  if (direct.success) return direct.data;
  if (Array.isArray(value)) {
    const legacyArray = modelLabSelectionSchema.safeParse({
      selectedModelIds: value,
    });
    if (legacyArray.success) return legacyArray.data;
  }
  return null;
}

function parseOpenRouterState(
  value: unknown,
  fallback: OpenRouterPersistentState,
): OpenRouterPersistentState {
  if (!isRecord(value)) return fallback;
  const rawCatalog = isRecord(value.catalog) ? value.catalog : null;
  const isModel = (item: unknown) =>
    isRecord(item) &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.canonicalSlug === "string" &&
    typeof item.promptPrice === "string" &&
    typeof item.completionPrice === "string" &&
    item.isFree === true;
  const isExcluded = (item: unknown) =>
    isRecord(item) &&
    typeof item.id === "string" &&
    ["paid", "router_alias", "missing_id", "malformed", "unsupported"].includes(
      String(item.reason),
    );
  const catalog =
    rawCatalog &&
    rawCatalog.schemaVersion === 1 &&
    typeof rawCatalog.catalogHash === "string" &&
    typeof rawCatalog.fetchedAt === "string" &&
    Array.isArray(rawCatalog.eligibleModels) &&
    rawCatalog.eligibleModels.every(isModel) &&
    Array.isArray(rawCatalog.excludedModels) &&
    rawCatalog.excludedModels.every(isExcluded)
      ? (rawCatalog as unknown as OpenRouterPersistentState["catalog"])
      : null;
  const rawRun = isRecord(value.benchmarkRun) ? value.benchmarkRun : {};
  const statuses = [
    "idle",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ];
  const benchmarkRun = {
    ...fallback.benchmarkRun,
    ...rawRun,
    status: statuses.includes(String(rawRun.status))
      ? rawRun.status
      : fallback.benchmarkRun.status,
    mode: "live" as const,
    concurrency: 1 as const,
    delayMs: 3200 as const,
    modelIds: Array.isArray(rawRun.modelIds)
      ? rawRun.modelIds
          .filter((item): item is string => typeof item === "string")
          .slice(0, 100)
      : [],
    completedModelIds: Array.isArray(rawRun.completedModelIds)
      ? rawRun.completedModelIds
          .filter((item): item is string => typeof item === "string")
          .slice(0, 100)
      : [],
    progress:
      typeof rawRun.progress === "number" && Number.isFinite(rawRun.progress)
        ? Math.max(0, Math.min(100, rawRun.progress))
        : 0,
  } as OpenRouterPersistentState["benchmarkRun"];
  const benchmarkResults = Array.isArray(value.benchmarkResults)
    ? (
        value.benchmarkResults.filter(
          (item) =>
            isRecord(item) &&
            typeof item.id === "string" &&
            typeof item.modelId === "string" &&
            typeof item.completedAt === "string" &&
            ["success", "failed", "cancelled", "mismatch"].includes(
              String(item.outcome),
            ),
        ) as OpenRouterPersistentState["benchmarkResults"]
      ).slice(0, 100)
    : [];
  return { catalog, benchmarkRun, benchmarkResults };
}

function parseDesktopState(
  value: unknown,
  fallback: DesktopPersistentStateV2,
): DesktopPersistentStateV2 {
  if (!isRecord(value)) return fallback;
  return {
    ...fallback,
    schemaVersion: 2,
    automationPolicy: automationPolicySchema.safeParse(value.automationPolicy)
      .success
      ? automationPolicySchema.parse(value.automationPolicy)
      : fallback.automationPolicy,
    executionHistory: Array.isArray(value.executionHistory)
      ? (value.executionHistory.filter(
          isExecutionRecord,
        ) as DesktopPersistentStateV2["executionHistory"])
      : fallback.executionHistory,
    modelLabPreferences: (() => {
      return (
        parseModelLabSelection(value.modelLabPreferences) ??
        fallback.modelLabPreferences
      );
    })(),
    modelLabHistory: Array.isArray(value.modelLabHistory)
      ? (value.modelLabHistory.filter(
          isModelLabHistory,
        ) as DesktopPersistentStateV2["modelLabHistory"])
      : fallback.modelLabHistory,
    subscriptions: Array.isArray(value.subscriptions)
      ? (value.subscriptions.filter(
          isSubscription,
        ) as DesktopPersistentStateV2["subscriptions"])
      : fallback.subscriptions,
    lastNotificationEventKey:
      typeof value.lastNotificationEventKey === "string"
        ? value.lastNotificationEventKey
        : null,
    preferences: parsePreferences(value.preferences, fallback.preferences),
    openrouter: parseOpenRouterState(value.openrouter, fallback.openrouter),
  };
}

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
    openrouter: emptyOpenRouterPersistentState(),
  };
}

export class DesktopStateRepository {
  load(): DesktopPersistentStateV2 {
    const fallback = defaultDesktopState();
    try {
      const raw = localStorage.getItem(DESKTOP_STATE_KEY);
      if (raw !== null) return parseDesktopState(parseJson(raw), fallback);
      return this.migrateLegacy(fallback);
    } catch {
      return fallback;
    }
  }

  save(state: DesktopPersistentStateV2) {
    localStorage.setItem(DESKTOP_STATE_KEY, JSON.stringify(state));
  }

  clear() {
    localStorage.removeItem(DESKTOP_STATE_KEY);
    for (const key of legacyKeys) localStorage.removeItem(key);
  }

  private migrateLegacy(
    fallback: DesktopPersistentStateV2,
  ): DesktopPersistentStateV2 {
    const rawValues = Object.fromEntries(
      legacyKeys.map((key) => [key, localStorage.getItem(key)]),
    ) as Record<string, string | null>;
    if (legacyKeys.every((key) => rawValues[key] === null)) return fallback;

    const legacyPolicy = parseJson(rawValues[LEGACY_DESKTOP_KEYS.policy]!);
    const legacyHistory = parseJson(rawValues[LEGACY_DESKTOP_KEYS.history]!);
    const legacyNotifications = parseJson(
      rawValues[LEGACY_DESKTOP_KEYS.notifications]!,
    );
    const legacyServices = parseJson(
      rawValues[LEGACY_DESKTOP_KEYS.aiServices]!,
    );
    const legacyModelLab = parseJson(rawValues[LEGACY_DESKTOP_KEYS.modelLab]!);
    const migrated: DesktopPersistentStateV2 = {
      ...fallback,
      schemaVersion: 2,
      automationPolicy: automationPolicySchema.safeParse(legacyPolicy).success
        ? automationPolicySchema.parse(legacyPolicy)
        : fallback.automationPolicy,
      executionHistory: Array.isArray(legacyHistory)
        ? (legacyHistory.filter(
            isExecutionRecord,
          ) as DesktopPersistentStateV2["executionHistory"])
        : fallback.executionHistory,
      modelLabPreferences: (() => {
        return (
          parseModelLabSelection(legacyModelLab) ?? fallback.modelLabPreferences
        );
      })(),
      preferences: {
        ...fallback.preferences,
        aiServices: Array.isArray(legacyServices)
          ? (legacyServices.filter(
              isServicePreference,
            ) as DesktopPersistentStateV2["preferences"]["aiServices"])
          : fallback.preferences.aiServices,
        notifications: parseLegacyNotificationPreferences(
          legacyNotifications,
          fallback.preferences.notifications,
        ),
      },
      lastNotificationEventKey: parseLegacyEventKey(
        rawValues[LEGACY_DESKTOP_KEYS.lastNotificationEvent]!,
      ),
    };

    try {
      this.save(migrated);
      for (const key of legacyKeys) localStorage.removeItem(key);
    } catch {
      // Preserve legacy keys if the normalized v2 write failed.
    }
    return migrated;
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
