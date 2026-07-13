import type {
  OpenRouterCatalogSnapshot,
  OpenRouterExcludedModel,
  OpenRouterModel,
} from "@quotaloop/contracts";

export const OPENROUTER_ROUTER_ALIASES = new Set([
  "openrouter/free",
  "openrouter/auto",
]);

const bounded = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";

const isZeroDecimal = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) && value === 0;
  if (typeof value !== "string") return false;
  return /^\+?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(value.trim());
};

export const isOpenRouterRouterAlias = (id: string) =>
  OPENROUTER_ROUTER_ALIASES.has(id.trim().toLowerCase());

export const canonicalFreePredicate = (raw: unknown) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id || isOpenRouterRouterAlias(id)) return false;
  const pricing =
    item.pricing && typeof item.pricing === "object"
      ? (item.pricing as Record<string, unknown>)
      : null;
  return Boolean(
    pricing &&
    isZeroDecimal(pricing.prompt) &&
    isZeroDecimal(pricing.completion),
  );
};

const excludedReason = (raw: unknown): OpenRouterExcludedModel["reason"] => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "malformed";
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) return "missing_id";
  if (isOpenRouterRouterAlias(id)) return "router_alias";
  return "paid";
};

export function normalizeOpenRouterCatalog(
  raw: unknown,
): OpenRouterCatalogSnapshot {
  const entries = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === "object" &&
        Array.isArray((raw as Record<string, unknown>).data)
      ? ((raw as Record<string, unknown>).data as unknown[])
      : [];
  const eligible: OpenRouterModel[] = [];
  const excluded: OpenRouterExcludedModel[] = [];
  for (const rawItem of entries.slice(0, 2000)) {
    if (!canonicalFreePredicate(rawItem)) {
      const id =
        rawItem &&
        typeof rawItem === "object" &&
        typeof (rawItem as Record<string, unknown>).id === "string"
          ? bounded((rawItem as Record<string, unknown>).id, 200)
          : "<missing>";
      excluded.push({ id, reason: excludedReason(rawItem) });
      continue;
    }
    const item = rawItem as Record<string, unknown>;
    const pricing = item.pricing as Record<string, unknown>;
    const id = bounded(item.id, 200);
    const architecture = item.architecture as
      Record<string, unknown> | undefined;
    eligible.push({
      id,
      name: bounded(item.name ?? id, 200),
      canonicalSlug: bounded(item.canonical_slug ?? id, 200),
      created:
        typeof item.created === "number" && Number.isFinite(item.created)
          ? item.created
          : null,
      contextLength:
        typeof item.context_length === "number" &&
        Number.isFinite(item.context_length)
          ? item.context_length
          : null,
      promptPrice: String(pricing.prompt ?? "0"),
      completionPrice: String(pricing.completion ?? "0"),
      isFree: true,
      isRouterAlias: false,
      supportsStreaming: architecture?.modality !== "embedding",
    });
  }
  eligible.sort((a, b) => a.id.localeCompare(b.id));
  excluded.sort(
    (a, b) => a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason),
  );
  const canonical = JSON.stringify({ eligible, excluded });
  return {
    schemaVersion: 1,
    fetchedAt: new Date().toISOString(),
    catalogHash: stableHash(canonical),
    eligibleModels: eligible,
    excludedModels: excluded,
  };
}

/** Deterministic non-secret hash used for snapshot identity and test fixtures. */
export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const catalogCounts = (snapshot: OpenRouterCatalogSnapshot | null) => ({
  eligible: snapshot?.eligibleModels.length ?? 0,
  excluded: snapshot?.excludedModels.length ?? 0,
});
