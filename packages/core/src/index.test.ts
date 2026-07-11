import { describe, expect, it } from "vitest";
import { defaultAutomationPolicy, evaluateAutomation } from "./index";
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
});
