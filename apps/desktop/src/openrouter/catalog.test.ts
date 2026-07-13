import { describe, expect, it } from "vitest";
import {
  canonicalFreePredicate,
  isOpenRouterRouterAlias,
  normalizeOpenRouterCatalog,
} from "./catalog";

describe("OpenRouter free catalog", () => {
  it("accepts exact zero decimal prices without floating point coercion", () => {
    expect(
      canonicalFreePredicate({
        id: "vendor/free:free",
        pricing: { prompt: "0", completion: "0.000" },
      }),
    ).toBe(true);
    expect(
      canonicalFreePredicate({
        id: "vendor/paid",
        pricing: { prompt: "0.0001", completion: "0" },
      }),
    ).toBe(false);
  });
  it("excludes router aliases but not free model suffixes", () => {
    expect(isOpenRouterRouterAlias("openrouter/free")).toBe(true);
    expect(
      canonicalFreePredicate({
        id: "openrouter/free",
        pricing: { prompt: "0", completion: "0" },
      }),
    ).toBe(false);
    expect(
      canonicalFreePredicate({
        id: "vendor/model:free",
        pricing: { prompt: "0", completion: "0" },
      }),
    ).toBe(true);
  });
  it("normalizes and hashes deterministically", () => {
    const snapshot = normalizeOpenRouterCatalog({
      data: [
        {
          id: "b/model:free",
          name: "B",
          pricing: { prompt: "0", completion: "0" },
        },
        {
          id: "a/model:free",
          name: "A",
          pricing: { prompt: "0", completion: "0" },
        },
        { id: "paid/model", pricing: { prompt: "1", completion: "1" } },
      ],
    });
    expect(snapshot.eligibleModels.map((model) => model.id)).toEqual([
      "a/model:free",
      "b/model:free",
    ]);
    expect(snapshot.excludedModels[0]?.reason).toBe("paid");
    expect(snapshot.catalogHash).toMatch(/^fnv1a:/);
  });
});
