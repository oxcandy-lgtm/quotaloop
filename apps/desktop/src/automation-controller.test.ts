import { beforeEach, describe, expect, it } from "vitest";
import {
  DesktopAutomationController,
  loadHistory,
  loadPolicy,
} from "./automation-controller";
import { MockCodexProvider } from "@quotaloop/providers";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

beforeEach(() => {
  localStorage.clear();
});

describe("DesktopAutomationController", () => {
  it("keeps automation disabled by default", async () => {
    const controller = new DesktopAutomationController();
    const result = await controller.evaluateAndRun(new Date());
    expect(result.decision.allowed).toBe(false);
  });
  it("runs Mock Codex once and blocks the duplicate key", async () => {
    const controller = new DesktopAutomationController();
    controller.setPolicy({ ...controller.currentPolicy, enabled: true });
    const now = new Date();
    const first = await controller.evaluateAndRun(now);
    const second = await controller.evaluateAndRun(now);
    expect(first.record?.outcome).toBe("success");
    expect(second.decision).toEqual({
      allowed: false,
      reason: "duplicate_execution",
    });
  });
  it("falls back safely for corrupt policy and history", () => {
    localStorage.setItem("quotaloop.desktop.policy", "{broken");
    localStorage.setItem(
      "quotaloop.desktop.history",
      JSON.stringify([{ nope: true }]),
    );
    expect(loadPolicy().enabled).toBe(false);
    expect(loadHistory()).toEqual([]);
  });
  it("atomically blocks simultaneous requests with one key", async () => {
    const controller = new DesktopAutomationController();
    controller.setPolicy({ ...controller.currentPolicy, enabled: true });
    const now = new Date();
    const [first, second] = await Promise.all([
      controller.evaluateAndRun(now),
      controller.evaluateAndRun(now),
    ]);
    expect([first.record, second.record].filter(Boolean)).toHaveLength(1);
    expect([first.decision.reason, second.decision.reason]).toContain(
      "duplicate_execution",
    );
  });
  it("preserves every policy field when pause changes", () => {
    const controller = new DesktopAutomationController();
    const original = {
      ...controller.currentPolicy,
      enabled: true,
      maximumRunsPerDay: 7,
      minimumRemainingPercent: 55,
      activeHours: { start: "23:00", end: "04:00", timeZone: "Asia/Tokyo" },
    };
    controller.setPolicy(original);
    controller.setPolicy({ ...controller.currentPolicy, paused: true });
    expect(controller.currentPolicy).toEqual({ ...original, paused: true });
  });
  it("resets canonical policy, memory, and persisted records safely", async () => {
    const controller = new DesktopAutomationController();
    controller.setPolicy({ ...controller.currentPolicy, enabled: true });
    await controller.evaluateAndRun(new Date());
    expect(controller.records).toHaveLength(1);
    const reset = controller.resetToSafeDefaults();
    expect(reset.policy.enabled).toBe(false);
    expect(reset.policy.paused).toBe(false);
    expect(controller.records).toEqual([]);
    expect(loadHistory()).toEqual([]);
    expect(loadPolicy().enabled).toBe(false);
    const blocked = await controller.evaluateAndRun(new Date());
    expect(blocked.decision.reason).toBe("disabled");
  });
  it("discards a completion that was in flight when reset was requested", async () => {
    const provider = new MockCodexProvider();
    let finish!: (value: {
      ok: boolean;
      providerId: string;
      completedAt: string;
      summary: string;
    }) => void;
    provider.runAction = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const controller = new DesktopAutomationController(provider);
    controller.setPolicy({ ...controller.currentPolicy, enabled: true });
    const pending = controller.evaluateAndRun(new Date());
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.resetToSafeDefaults();
    finish({
      ok: true,
      providerId: provider.id,
      completedAt: new Date().toISOString(),
      summary: "finished after reset",
    });

    const result = await pending;
    expect(result.record).toBeUndefined();
    expect(controller.records).toEqual([]);
    expect(loadHistory()).toEqual([]);
    expect(controller.currentPolicy.enabled).toBe(false);
  });
});
