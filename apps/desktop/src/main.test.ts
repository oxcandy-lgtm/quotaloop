import { describe, expect, it } from "vitest";
import { resolveDesktopSurface } from "./surface";

describe("desktop surface resolver", () => {
  it("selects distinct popover and dashboard roots", () => {
    expect(resolveDesktopSurface("?surface=popover")).toBe("popover");
    expect(resolveDesktopSurface("?surface=dashboard")).toBe("dashboard");
    expect(resolveDesktopSurface("?surface=settings")).toBe("settings");
  });
  it("fails closed to the compact popover", () => {
    expect(resolveDesktopSurface("?surface=unknown")).toBe("popover");
  });
});
