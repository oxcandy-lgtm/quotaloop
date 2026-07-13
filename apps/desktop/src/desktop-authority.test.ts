import { beforeEach, describe, expect, it } from "vitest";
import type {
  DesktopRequestEnvelope,
  DesktopRequestType,
} from "@quotaloop/contracts";
import { DesktopAuthority } from "./desktop-authority";

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

beforeEach(() => values.clear());

describe("DesktopAuthority transport and lifecycle", () => {
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
    await new Promise((resolve) => setTimeout(resolve, 90));
    authority.reset();
    finish();
    const result = await pending;
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("reset_generation");
    expect(authority.getSnapshot().modelLabRunState.status).toBe("idle");
    expect(authority.getSnapshot().persistent.modelLabHistory).toEqual([]);
  });
});
