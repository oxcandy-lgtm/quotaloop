import { beforeEach, describe, expect, it } from "vitest";
import type {
  DesktopRequestEnvelope,
  DesktopRequestType,
  OpenRouterBenchmarkResult,
} from "@quotaloop/contracts";
import { DesktopAuthority } from "./desktop-authority";
import {
  DESKTOP_STATE_KEY,
  LEGACY_DESKTOP_KEYS,
} from "./desktop-state-repository";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
  configurable: true,
});

const request = <T>(
  type: DesktopRequestType,
  payload: T,
): DesktopRequestEnvelope<T> => ({
  schemaVersion: 2,
  requestId: crypto.randomUUID(),
  type,
  payload,
});

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("authority state did not settle in time");
};

beforeEach(() => values.clear());

describe("DesktopAuthority transport and lifecycle", () => {
  it("hydrates valid legacy controller slices before applying authority state", async () => {
    values.set(
      LEGACY_DESKTOP_KEYS.policy,
      JSON.stringify({
        enabled: true,
        paused: false,
        actionMode: "minimal",
        maximumRunsPerDay: 2,
        minimumRemainingPercent: 40,
        activeHours: { start: "00:00", end: "24:00", timeZone: "UTC" },
        targetProviders: ["codex-demo"],
      }),
    );
    values.set(
      LEGACY_DESKTOP_KEYS.history,
      JSON.stringify([
        {
          id: "legacy-record",
          providerId: "codex-demo",
          startedAt: "2030-01-01T00:00:00.000Z",
          completedAt: "2030-01-01T00:01:00.000Z",
          outcome: "success",
          reason: "legacy",
          idempotencyKey: "legacy-key",
        },
      ]),
    );

    const authority = new DesktopAuthority();
    await authority.hydrate();
    expect(authority.getSnapshot().persistent.automationPolicy.enabled).toBe(
      true,
    );
    expect(authority.getSnapshot().persistent.executionHistory).toHaveLength(1);
    expect(values.has(DESKTOP_STATE_KEY)).toBe(true);

    authority.reset();
    const resetSnapshot = authority.getSnapshot();
    expect(resetSnapshot.persistent.automationPolicy.enabled).toBe(false);
    expect(resetSnapshot.persistent.automationPolicy.paused).toBe(false);
    expect(resetSnapshot.persistent.executionHistory).toEqual([]);
    expect(
      Object.values(LEGACY_DESKTOP_KEYS).every((key) => !values.has(key)),
    ).toBe(true);
    const restarted = new DesktopAuthority();
    await restarted.hydrate();
    expect(restarted.getSnapshot().persistent.executionHistory).toEqual([]);
    expect(restarted.getSnapshot().persistent.automationPolicy.enabled).toBe(
      false,
    );
  });

  it("validates requests, correlates acknowledgements, and persists canonical slices", async () => {
    const authority = new DesktopAuthority();
    await authority.hydrate();
    const policy = { ...authority.controller.currentPolicy, enabled: true };
    const policyResult = await authority.handleRequest(
      request("automation_policy_requested", policy),
    );
    expect(policyResult.accepted).toBe(true);
    expect(policyResult.requestId).not.toBe("");

    const subscription = {
      id: "sub-demo",
      providerId: "codex-demo",
      plan: "Synthetic",
      monthlyPrice: 0,
      currency: "USD",
      renewalDate: "2030-01-01",
      autoRenew: false,
      notes: "fixture",
    };
    expect(
      (
        await authority.handleRequest(
          request("subscription_requested", { operation: "add", subscription }),
        )
      ).accepted,
    ).toBe(true);
    expect(
      (
        await authority.handleRequest(
          request("model_lab_selection_requested", {
            selectedModelIds: ["demo-model-01", "demo-model-02"],
          }),
        )
      ).accepted,
    ).toBe(true);
    expect(
      (
        await authority.handleRequest(
          request("notification_preference_requested", {
            enabled: true,
            actionCompleted: true,
          }),
        )
      ).accepted,
    ).toBe(true);
    authority.lastNotificationKey = "event-1";

    const duplicate = await authority.handleRequest({
      ...request("automation_policy_requested", policy),
      type: "unknown_request",
    });
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.reason).toBe("invalid_request_envelope");
    expect(authority.getSnapshot().persistent.subscriptions).toHaveLength(1);

    const run = await authority.runModelLab(
      async () => undefined,
      crypto.randomUUID(),
    );
    expect(run.accepted).toBe(true);
    expect(
      authority.getSnapshot().persistent.modelLabHistory[0]?.modelIds,
    ).toEqual(["demo-model-01", "demo-model-02"]);
  });

  it("restores state after restart and returns to safe defaults after reset", async () => {
    const first = new DesktopAuthority();
    await first.hydrate();
    await first.handleRequest(
      request("subscription_requested", {
        operation: "add",
        subscription: {
          id: "sub-restart",
          providerId: "codex-demo",
          plan: "Restart",
          monthlyPrice: 0,
          currency: "USD",
          renewalDate: "2030-01-01",
          autoRenew: false,
          notes: "persisted",
        },
      }),
    );
    await first.handleRequest(
      request("model_lab_selection_requested", {
        selectedModelIds: ["demo-model-03"],
      }),
    );
    first.lastNotificationKey = "persisted-event";

    const second = new DesktopAuthority();
    await second.hydrate();
    expect(second.getSnapshot().persistent.subscriptions[0]?.id).toBe(
      "sub-restart",
    );
    expect(
      second.getSnapshot().persistent.modelLabPreferences.selectedModelIds,
    ).toEqual(["demo-model-03"]);
    expect(second.lastNotificationKey).toBe("persisted-event");
    expect(second.getSnapshot().modelLabRunState.status).toBe("idle");

    second.reset();
    const third = new DesktopAuthority();
    await third.hydrate();
    const snapshot = third.getSnapshot();
    expect(snapshot.persistent.automationPolicy.enabled).toBe(false);
    expect(snapshot.persistent.executionHistory).toEqual([]);
    expect(snapshot.persistent.subscriptions).toEqual([]);
    expect(snapshot.persistent.modelLabPreferences.selectedModelIds).toEqual(
      [],
    );
    expect(snapshot.persistent.modelLabHistory).toEqual([]);
    expect(snapshot.persistent.preferences.notifications.enabled).toBe(false);
    expect(third.lastNotificationKey).toBeNull();
  });

  it("does not restore a stale in-flight run after reset", async () => {
    const authority = new DesktopAuthority();
    await authority.hydrate();
    let finish!: () => void;
    const pending = authority.runModelLab(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      crypto.randomUUID(),
    );
    await waitFor(() => typeof finish === "function");
    authority.reset();
    finish();
    const result = await pending;
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("reset_generation");
    expect(authority.getSnapshot().modelLabRunState.status).toBe("idle");
    expect(authority.getSnapshot().persistent.modelLabHistory).toEqual([]);
  });

  it("hydrates a live catalog through the authority and persists a resumable run", async () => {
    const authority = new DesktopAuthority();
    await authority.hydrate();
    const catalogResult = await authority.handleRequest(
      request("openrouter_catalog_refresh_requested", {}),
      {
        openrouterCatalog: async () => ({
          data: [
            {
              id: "vendor/model:free",
              name: "Free fixture",
              pricing: { prompt: "0", completion: "0" },
            },
          ],
        }),
      },
    );
    expect(catalogResult.accepted).toBe(true);
    const catalog = authority.getSnapshot().openrouter.catalog!;
    const benchmarkResult: OpenRouterBenchmarkResult = {
      id: "run-1",
      modelId: "vendor/model:free",
      modelName: "Free fixture",
      manifestId: "quotaloop.openrouter.free-benchmark.v1",
      catalogHash: catalog.catalogHash,
      completedAt: new Date().toISOString(),
      outcome: "success",
      metrics: null,
      caseScores: [],
    };
    const runResult = await authority.handleRequest(
      request("openrouter_benchmark_requested", {
        modelIds: ["vendor/model:free"],
        catalogHash: catalog.catalogHash,
      }),
      {
        openrouterKeyStatus: async () => ({ configured: true }),
        openrouterRunModel: async () => benchmarkResult,
      },
    );
    expect(runResult.accepted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      authority.getSnapshot().openrouter.benchmarkResults[0]?.modelId,
    ).toBe("vendor/model:free");
    expect(
      authority.getSnapshot().openrouter.benchmarkRun.completedModelIds,
    ).toEqual(["vendor/model:free"]);
    expect(values.get(DESKTOP_STATE_KEY)).toContain("vendor/model:free");
  });

  it("does not write a completion after authority reset cancels a live run", async () => {
    const authority = new DesktopAuthority();
    await authority.hydrate();
    await authority.handleRequest(
      request("openrouter_catalog_refresh_requested", {}),
      {
        openrouterCatalog: async () => ({
          data: [
            {
              id: "vendor/model:free",
              pricing: { prompt: "0", completion: "0" },
            },
          ],
        }),
      },
    );
    let finish!: (result: OpenRouterBenchmarkResult) => void;
    const pending = new Promise<OpenRouterBenchmarkResult>((resolve) => {
      finish = resolve;
    });
    const catalog = authority.getSnapshot().openrouter.catalog!;
    await authority.handleRequest(
      request("openrouter_benchmark_requested", {
        modelIds: ["vendor/model:free"],
        catalogHash: catalog.catalogHash,
      }),
      {
        openrouterKeyStatus: async () => ({ configured: true }),
        openrouterRunModel: async () => pending,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    authority.reset();
    finish({
      id: "late",
      modelId: "vendor/model:free",
      modelName: "late",
      manifestId: "quotaloop.openrouter.free-benchmark.v1",
      catalogHash: catalog.catalogHash,
      completedAt: new Date().toISOString(),
      outcome: "success",
      metrics: null,
      caseScores: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(authority.getSnapshot().openrouter.benchmarkResults).toEqual([]);
  });
});
