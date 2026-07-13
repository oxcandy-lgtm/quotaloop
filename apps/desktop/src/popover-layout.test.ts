// @ts-expect-error The desktop package does not ship Node runtime typings.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");

describe("macOS Popover layout contract", () => {
  it("constrains intrinsic children to the Popover content width", () => {
    expect(styles).toContain(".popover fieldset");
    expect(styles).toContain(".popover .model-lab-popover");
    expect(styles).toContain(".popover .lab-metrics");
    expect(styles).toContain("min-inline-size: 0");
    expect(styles).toContain("margin-inline: 0");
    expect(styles).toContain("overflow-wrap: anywhere");
  });

  it("keeps the branded header outside the accessible tablist", () => {
    expect(styles).toContain("grid-template-columns: auto minmax(0, 1fr) auto");
    expect(main).toContain('className="popover-brand"');
    expect(main).toContain('role="tablist"');
    expect(main).toContain('aria-label="Settings"');
    expect(main).toContain('invoke("open_settings_window")');
  });

  it("defines a compact, vertically scrolling Settings surface", () => {
    expect(styles).toContain(".settings-surface");
    expect(styles).toContain(".settings-layout");
    expect(styles).toContain("grid-template-columns: 145px minmax(0, 1fr)");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).toContain("overflow-x: hidden");
    expect(styles).toContain(".settings-option-list");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(main).toContain('className="settings-surface"');
    expect(main).toContain('className="settings-option-list"');
    expect(main).toContain('className="settings-toggle-row"');
    expect(main).toContain('aria-label="Settings sections"');
  });

  it("keeps detect-only provider states truthful", () => {
    expect(main).toContain("Quota unavailable");
    expect(main).toContain("Detection timed out");
    expect(main).toContain("Detection failed");
  });
});
