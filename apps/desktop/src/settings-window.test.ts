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

  it("uses the existing authority transport without a second authority", () => {
    expect(main).toContain("function useDesktopClient");
    expect(main).toContain("request_desktop");
    expect(main).toContain("desktop-ack");
    expect(main).toContain("desktop-snapshot");
    expect(main.match(/new DesktopAuthority/g)).toHaveLength(1);
  });
});
