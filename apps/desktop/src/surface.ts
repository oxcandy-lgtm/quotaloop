export type DesktopSurface = "popover" | "dashboard";
export function resolveDesktopSurface(source: string): DesktopSurface {
  return new URLSearchParams(
    source.startsWith("?") ? source : `?${source}`,
  ).get("surface") === "dashboard"
    ? "dashboard"
    : "popover";
}
