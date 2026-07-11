import { describe, expect, it, vi } from "vitest";
import { LocalScheduler } from "./index";
describe("LocalScheduler", () => {
  it("does not start twice", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const scheduler = new LocalScheduler(fn, 1000);
    scheduler.start();
    scheduler.start();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    scheduler.stop();
    vi.useRealTimers();
  });
});
