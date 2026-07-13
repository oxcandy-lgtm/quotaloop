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
});
