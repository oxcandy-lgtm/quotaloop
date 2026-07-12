import { describe, expect, it } from "vitest";
import {
  defaultAutomationPolicy,
  evaluateAutomation,
  runsOnLocalDay,
} from "./index";
const now = new Date("2026-01-15T12:00:00.000Z");
const quota = {
  providerId: "demo",
  state: "mock" as const,
  origin: "mock" as const,
  sessionRemainingPercent: 72,
  weeklyRemainingPercent: 64,
  resetsAt: null,
  observedAt: now.toISOString(),
  staleAfter: "2027-01-01T00:00:00.000Z",
};
const base = {
  policy: defaultAutomationPolicy("UTC"),
  quota,
  authenticated: true,
  canRun: true,
  now,
  todayRuns: 0,
  duplicate: false,
  running: false,
};
describe("evaluateAutomation", () => {
  it("is disabled by default", () =>
    expect(evaluateAutomation(base)).toEqual({
      allowed: false,
      reason: "disabled",
    }));
  it("allows a ready enabled policy", () =>
    expect(
      evaluateAutomation({
        ...base,
        policy: {
          ...base.policy,
          enabled: true,
          activeHours: { start: "00:00", end: "24:00", timeZone: "UTC" },
        },
      }).allowed,
    ).toBe(true));
  it("blocks the daily limit", () =>
    expect(
      evaluateAutomation({
        ...base,
        todayRuns: 2,
        policy: {
          ...base.policy,
          enabled: true,
          activeHours: { start: "00:00", end: "24:00", timeZone: "UTC" },
        },
      }),
    ).toEqual({ allowed: false, reason: "daily_limit" }));
  it("does not let manual override bypass fundamental safety", () => {
    expect(
      evaluateAutomation({ ...base, manualOverride: true, canRun: false }),
    ).toEqual({ allowed: false, reason: "unsupported_action" });
    expect(
      evaluateAutomation({ ...base, manualOverride: true, duplicate: true }),
    ).toEqual({ allowed: false, reason: "duplicate_execution" });
    expect(
      evaluateAutomation({
        ...base,
        manualOverride: true,
        quota: { ...quota, staleAfter: "invalid" },
      }),
    ).toEqual({ allowed: false, reason: "stale_data" });
  });
  it("evaluates configured timezone and overnight windows", () => {
    const policy = {
      ...base.policy,
      enabled: true,
      activeHours: { start: "22:00", end: "02:00", timeZone: "Asia/Tokyo" },
    };
    expect(
      evaluateAutomation({
        ...base,
        policy,
        now: new Date("2026-01-15T14:00:00.000Z"),
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAutomation({
        ...base,
        policy,
        now: new Date("2026-01-15T04:00:00.000Z"),
      }),
    ).toEqual({ allowed: false, reason: "outside_active_hours" });
  });
  it("fails closed for invalid timezone and time", () => {
    const enabled = {
      ...base.policy,
      enabled: true,
      activeHours: { start: "25:00", end: "24:00", timeZone: "Not/AZone" },
    };
    expect(evaluateAutomation({ ...base, policy: enabled })).toEqual({
      allowed: false,
      reason: "outside_active_hours",
    });
  });
  it("counts daily runs in the configured timezone", () => {
    const records = [
      {
        id: "1",
        providerId: "demo",
        startedAt: "2026-01-15T23:30:00.000Z",
        completedAt: "2026-01-15T23:31:00.000Z",
        outcome: "success" as const,
        reason: "ok",
        idempotencyKey: "demo:minimal:2026-01-15T23:30",
      },
    ];
    const instant = new Date("2026-01-16T00:30:00.000Z");
    expect(runsOnLocalDay(records, instant, "Asia/Tokyo")).toBe(1);
    expect(runsOnLocalDay(records, instant, "UTC")).toBe(0);
    expect(runsOnLocalDay(records, instant, "America/Los_Angeles")).toBe(1);
  });
});
