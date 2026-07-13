export type DesktopSurface = "popover" | "dashboard" | "settings";
export function resolveDesktopSurface(source: string): DesktopSurface {
  const surface = new URLSearchParams(
    source.startsWith("?") ? source : `?${source}`,
  ).get("surface");
  return surface === "dashboard"
    ? "dashboard"
    : surface === "settings"
      ? "settings"
      : "popover";
}
