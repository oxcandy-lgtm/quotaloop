import { beforeEach, describe, expect, it } from "vitest";
import {
  LocalStorageRepository,
  normalizeServicePreferences,
  type AppData,
} from "./index";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
const fallback: AppData = {
  schemaVersion: 2,
  policy: {
    enabled: false,
    paused: false,
    actionMode: "minimal",
    maximumRunsPerDay: 2,
    minimumRemainingPercent: 40,
    activeHours: { start: "00:00", end: "24:00", timeZone: "UTC" },
    targetProviders: ["codex"],
  },
  history: [],
  subscriptions: [],
  theme: "system",
  onboardingComplete: true,
  notifications: {
    webEnabled: false,
    desktopEnabled: false,
    actionCompleted: true,
    testNotification: true,
  },
  aiServices: [],
  credentials: [],
  modelLab: { selectedModelIds: [] },
  modelLabHistory: [],
  lastNotificationEventKey: null,
};
beforeEach(() => values.clear());
describe("AppData v2 migration", () => {
  it("fills v2 fields for v1 data", () => {
    values.set(
      "quotaloop.v1",
      JSON.stringify({
        schemaVersion: 1,
        policy: fallback.policy,
        history: [],
        subscriptions: [],
        theme: "system",
        onboardingComplete: true,
        notifications: fallback.notifications,
      }),
    );
    const result = new LocalStorageRepository().load(fallback);
    expect(result.schemaVersion).toBe(2);
    expect(result.modelLab.selectedModelIds).toEqual([]);
  });
  it("disables duplicate service preferences conservatively", () => {
    const preference = {
      serviceId: "demo",
      enabled: true,
      visibleInQuota: true,
      visibleInModelLab: true,
      allowCatalogAccess: true,
      allowBenchmarkRequests: true,
      favorite: true,
    };
    expect(normalizeServicePreferences([preference, preference])).toEqual([
      {
        serviceId: "demo",
        enabled: false,
        visibleInQuota: false,
        visibleInModelLab: false,
        allowCatalogAccess: false,
        allowBenchmarkRequests: false,
        favorite: false,
      },
    ]);
  });
  it("falls back per slice and filters malformed records without erasing siblings", () => {
    values.set(
      "quotaloop.v1",
      JSON.stringify({
        policy: { broken: true },
        history: [
          {
            id: "valid",
            providerId: "codex",
            startedAt: "2030-01-01T00:00:00.000Z",
            completedAt: "2030-01-01T00:01:00.000Z",
            outcome: "success",
            reason: "ok",
            idempotencyKey: "key",
          },
          { malformed: true },
        ],
        theme: "dark",
        notifications: { webEnabled: true },
        modelLab: { selectedModelIds: ["not-a-demo-model"] },
      }),
    );
    const result = new LocalStorageRepository().load(fallback);
    expect(result.policy.enabled).toBe(false);
    expect(result.history).toHaveLength(1);
    expect(result.theme).toBe("dark");
    expect(result.notifications).toEqual(fallback.notifications);
    expect(result.modelLab.selectedModelIds).toEqual([]);
  });
});
