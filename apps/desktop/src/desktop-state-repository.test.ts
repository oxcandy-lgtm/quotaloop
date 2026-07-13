import { beforeEach, describe, expect, it } from "vitest";
import {
  DESKTOP_STATE_KEY,
  DesktopStateRepository,
  LEGACY_DESKTOP_KEYS,
} from "./desktop-state-repository";

const values = new Map<string, string>();
let failV2Write = false;
let v2Writes = 0;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (key === DESKTOP_STATE_KEY) {
        v2Writes += 1;
        if (failV2Write) throw new Error("storage full");
      }
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  },
});

const validPolicy = {
  enabled: true,
  paused: false,
  actionMode: "minimal" as const,
  maximumRunsPerDay: 2,
  minimumRemainingPercent: 40,
  activeHours: { start: "00:00", end: "24:00", timeZone: "UTC" },
  targetProviders: ["codex-demo"],
};
const validHistory = {
  id: "legacy-history",
  providerId: "codex-demo",
  startedAt: "2030-01-01T00:00:00.000Z",
  completedAt: "2030-01-01T00:01:00.000Z",
  outcome: "success" as const,
  reason: "legacy",
  idempotencyKey: "legacy-key",
};
const validServicePreference = {
  serviceId: "codex-demo",
  enabled: true,
  visibleInQuota: true,
  visibleInModelLab: true,
  allowCatalogAccess: true,
  allowBenchmarkRequests: true,
  favorite: true,
};

beforeEach(() => {
  values.clear();
  failV2Write = false;
  v2Writes = 0;
});

describe("DesktopStateRepository legacy migration", () => {
  it("migrates every valid legacy slice into one normalized v2 state", () => {
    values.set(LEGACY_DESKTOP_KEYS.policy, JSON.stringify(validPolicy));
    values.set(LEGACY_DESKTOP_KEYS.history, JSON.stringify([validHistory]));
    values.set(
      LEGACY_DESKTOP_KEYS.notifications,
      JSON.stringify({ enabled: true, actionCompleted: false }),
    );
    values.set(
      LEGACY_DESKTOP_KEYS.aiServices,
      JSON.stringify([validServicePreference]),
    );
    values.set(
      LEGACY_DESKTOP_KEYS.modelLab,
      JSON.stringify({ selectedModelIds: ["demo-model-02"] }),
    );
    values.set(LEGACY_DESKTOP_KEYS.lastNotificationEvent, "legacy-event");

    const state = new DesktopStateRepository().load();

    expect(state.automationPolicy.enabled).toBe(true);
    expect(state.executionHistory).toEqual([validHistory]);
    expect(state.preferences.notifications).toEqual({
      enabled: true,
      actionCompleted: false,
    });
    expect(state.preferences.aiServices).toEqual([validServicePreference]);
    expect(state.modelLabPreferences.selectedModelIds).toEqual([
      "demo-model-02",
    ]);
    expect(state.lastNotificationEventKey).toBe("legacy-event");
    expect(values.has(DESKTOP_STATE_KEY)).toBe(true);
    expect(
      Object.values(LEGACY_DESKTOP_KEYS).every((key) => !values.has(key)),
    ).toBe(true);
  });

  it("falls back independently for corrupt legacy slices", () => {
    values.set(LEGACY_DESKTOP_KEYS.policy, JSON.stringify(validPolicy));
    values.set(
      LEGACY_DESKTOP_KEYS.history,
      JSON.stringify([validHistory, { malformed: true }]),
    );
    values.set(LEGACY_DESKTOP_KEYS.notifications, "{broken");
    values.set(
      LEGACY_DESKTOP_KEYS.aiServices,
      JSON.stringify([validServicePreference, { serviceId: 42 }]),
    );
    values.set(
      LEGACY_DESKTOP_KEYS.modelLab,
      JSON.stringify({ selectedModelIds: [42] }),
    );
    values.set(
      LEGACY_DESKTOP_KEYS.lastNotificationEvent,
      JSON.stringify({ invalid: true }),
    );

    const state = new DesktopStateRepository().load();

    expect(state.automationPolicy.enabled).toBe(true);
    expect(state.executionHistory).toHaveLength(1);
    expect(state.preferences.notifications.enabled).toBe(false);
    expect(state.preferences.aiServices).toEqual([validServicePreference]);
    expect(state.modelLabPreferences.selectedModelIds).toEqual([]);
    expect(state.lastNotificationEventKey).toBeNull();
  });

  it("persists migration once and reads v2 on the next restart", () => {
    values.set(LEGACY_DESKTOP_KEYS.policy, JSON.stringify(validPolicy));

    const first = new DesktopStateRepository().load();
    expect(first.automationPolicy.enabled).toBe(true);
    expect(v2Writes).toBe(1);

    v2Writes = 0;
    const second = new DesktopStateRepository().load();
    expect(second.automationPolicy.enabled).toBe(true);
    expect(v2Writes).toBe(0);
  });

  it("keeps legacy data when the normalized v2 save fails", () => {
    values.set(LEGACY_DESKTOP_KEYS.policy, JSON.stringify(validPolicy));
    failV2Write = true;

    const state = new DesktopStateRepository().load();

    expect(state.automationPolicy.enabled).toBe(true);
    expect(values.has(LEGACY_DESKTOP_KEYS.policy)).toBe(true);
    expect(values.has(DESKTOP_STATE_KEY)).toBe(false);
  });

  it("clears v2 and any remaining legacy keys during reset", () => {
    values.set(DESKTOP_STATE_KEY, JSON.stringify({ schemaVersion: 2 }));
    values.set(LEGACY_DESKTOP_KEYS.history, JSON.stringify([validHistory]));

    new DesktopStateRepository().clear();

    expect(values.size).toBe(0);
  });

  it("falls back safely when the persisted OpenRouter slice is corrupt", () => {
    values.set(
      DESKTOP_STATE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        automationPolicy: validPolicy,
        openrouter: {
          catalog: {
            schemaVersion: 1,
            catalogHash: "bad",
            fetchedAt: "bad",
            eligibleModels: [{ id: 42 }],
            excludedModels: "bad",
          },
          benchmarkRun: { status: "unknown", modelIds: "bad" },
          benchmarkResults: [{ id: 42 }],
        },
      }),
    );

    const state = new DesktopStateRepository().load();

    expect(state.automationPolicy.enabled).toBe(true);
    expect(state.openrouter.catalog).toBeNull();
    expect(state.openrouter.benchmarkRun.status).toBe("idle");
    expect(state.openrouter.benchmarkResults).toEqual([]);
  });
});
