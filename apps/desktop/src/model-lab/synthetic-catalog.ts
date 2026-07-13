export const syntheticCatalog = Array.from({ length: 24 }, (_, index) => ({
  id: `demo-model-${String(index + 1).padStart(2, "0")}`,
  name: `Demo Model ${String.fromCharCode(65 + (index % 26))}${index + 1}`,
  free: true,
  isNew: index < 3,
  changed: index === 3,
  measured: index < 12,
}));
export const syntheticScores = [
  { modelId: "demo-model-01", score: 86 },
  { modelId: "demo-model-02", score: 81 },
  { modelId: "demo-model-03", score: 77 },
];
export function modelLabViewModel() {
  return {
    freeCount: syntheticCatalog.filter((item) => item.free).length,
    newCount: syntheticCatalog.filter((item) => item.isNew).length,
    changedCount: syntheticCatalog.filter((item) => item.changed).length,
    measuredCount: syntheticCatalog.filter((item) => item.measured).length,
    scores: syntheticScores.map((score) => ({
      ...score,
      name:
        syntheticCatalog.find((item) => item.id === score.modelId)?.name ??
        score.modelId,
    })),
  };
}
