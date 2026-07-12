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
  it("prevents overlapping async evaluations and records rejection", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fn = vi.fn(() => pending);
    const scheduler = new LocalScheduler(fn, 1000);
    scheduler.start();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    scheduler.stop();
    vi.useRealTimers();
  });
  it("swallows rejected evaluations and resume is idempotent", async () => {
    vi.useFakeTimers();
    const scheduler = new LocalScheduler(async () => {
      throw new Error("demo failure");
    }, 1000);
    scheduler.resume();
    await Promise.resolve();
    expect(scheduler.running).toBe(true);
    expect(scheduler.lastError).toBeInstanceOf(Error);
    scheduler.resume();
    scheduler.stop();
    expect(scheduler.running).toBe(false);
    vi.useRealTimers();
  });
});
