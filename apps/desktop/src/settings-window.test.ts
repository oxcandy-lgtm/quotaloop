// @ts-expect-error The desktop package does not ship Node runtime typings.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rust = readFileSync(
  new URL("./../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const config = JSON.parse(
  readFileSync(
    new URL("./../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
) as { app: { windows: Array<{ label: string }> } };

describe("macOS Settings window contract", () => {
  it("is created dynamically instead of statically configured", () => {
    expect(config.app.windows.map((window) => window.label)).not.toContain(
      "settings",
    );
    expect(rust).toContain("WebviewWindowBuilder::new");
    expect(rust).toContain('WebviewUrl::App("index.html?surface=settings"');
  });

  it("covers current-space lifecycle and failure cleanup decisions", () => {
    expect(rust).toContain("SettingsWindowAction::FocusExisting");
    expect(rust).toContain("SettingsWindowAction::DestroyAndCreate");
    expect(rust).toContain("release_settings_suppression");
    expect(rust).toContain('window.label() == "settings"');

    const suppressionIndex = rust.indexOf(
      "set_auto_hide_suppressed(app, true);",
    );
    const focusIndex = rust.indexOf("focus_settings_window(&window)");
    expect(suppressionIndex).toBeGreaterThanOrEqual(0);
    expect(focusIndex).toBeGreaterThan(suppressionIndex);
  });

  it("restores the Popover only for a user-visible Settings close", () => {
    expect(rust).toContain("restore_popover_on_settings_destroy");
    expect(rust).toContain("SettingsDestroyAction::RestorePopover");
    expect(rust).toContain("SettingsDestroyAction::ReleaseOnly");
    expect(rust).toContain("restore_popover_after_settings_close");
    expect(rust).toContain("WindowEvent::Destroyed");
    const restoreStart = rust.indexOf(
      "fn restore_popover_after_settings_close",
    );
    const restoreEnd = rust.indexOf('#[cfg(target_os = "macos")]');
    expect(restoreStart).toBeGreaterThanOrEqual(0);
    expect(rust.slice(restoreStart, restoreEnd)).not.toContain(
      "popover.hide()",
    );
    expect(rust).toContain(
      "set_restore_popover_on_settings_destroy(app, false);",
    );
  });

  it("keeps the compact dimensions and one-column option contract", () => {
    expect(rust).toContain(".inner_size(520.0, 620.0)");
    expect(rust).toContain(".min_inner_size(480.0, 520.0)");
    expect(main.match(/settings-option-list/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
    expect(main).toContain("Visible in Quota");
    expect(main).toContain("Allow benchmark requests");
  });

  it("uses the existing authority transport without a second authority", () => {
    expect(main).toContain("function useDesktopClient");
    expect(main).toContain("request_desktop");
    expect(main).toContain("desktop-ack");
    expect(main).toContain("desktop-snapshot");
    expect(main.match(/new DesktopAuthority/g)).toHaveLength(1);
  });
});
