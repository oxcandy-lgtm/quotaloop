import { beforeEach, describe, expect, it } from "vitest";
import { DesktopAutomationController } from "./automation-controller";

beforeEach(() => {
  /* controller storage is isolated per test process */
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
});
