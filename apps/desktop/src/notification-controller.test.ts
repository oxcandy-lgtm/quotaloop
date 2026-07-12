import { describe, expect, it } from "vitest";
import { shouldDeliverNotification } from "./notification-controller";
const base = {
  preferences: { enabled: true, actionCompleted: true },
  permission: true,
  eventKey: "event-1",
  lastEventKey: null,
};
describe("notification decision", () => {
  it("covers disabled, denied, first, duplicate, distinct, and action preference", () => {
    expect(
      shouldDeliverNotification({
        ...base,
        preferences: { enabled: false, actionCompleted: true },
      }),
    ).toBe(false);
    expect(shouldDeliverNotification({ ...base, permission: false })).toBe(
      false,
    );
    expect(shouldDeliverNotification(base)).toBe(true);
    expect(
      shouldDeliverNotification({ ...base, lastEventKey: "event-1" }),
    ).toBe(false);
    expect(
      shouldDeliverNotification({
        ...base,
        eventKey: "event-2",
        lastEventKey: "event-1",
      }),
    ).toBe(true);
    expect(
      shouldDeliverNotification({
        ...base,
        preferences: { enabled: true, actionCompleted: false },
      }),
    ).toBe(false);
  });
});
