import type {
  OpenRouterBenchmarkCase,
  OpenRouterBenchmarkMetrics,
} from "@quotaloop/contracts";

export const normalizeAnswer = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/```(?:json|text|javascript|typescript|python)?/gi, "")
    .replace(/```/g, "")
    .replace(/[。．.!！?？]+$/u, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();

export function extractTextAnswer(value: string): string {
  const trimmed = value.trim();
  const jsonCandidate = trimmed
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["answer", "output", "text", "content"])
        if (typeof record[key] === "string") return record[key];
    }
  } catch {
    // Plain text is the expected format for the deterministic manifest.
  }
  return trimmed;
}

export function scoreCase(testCase: OpenRouterBenchmarkCase, answer: string) {
  const actual = normalizeAnswer(extractTextAnswer(answer));
  const expected = normalizeAnswer(testCase.expectedAnswer);
  const tokenHit = (testCase.expectedTokens ?? []).every((token) =>
    actual.includes(normalizeAnswer(token)),
  );
  const passed = actual === expected || (tokenHit && expected.length > 0);
  return { caseId: testCase.id, score: passed ? 100 : 0, passed };
}

export function scoreBenchmark(
  cases: OpenRouterBenchmarkCase[],
  answers: Record<string, string>,
  timing: {
    ttftMs?: number | null;
    totalLatencyMs?: number | null;
    completionTokens?: number | null;
    promptTokens?: number | null;
  } = {},
): {
  caseScores: Array<{ caseId: string; score: number; passed: boolean }>;
  metrics: OpenRouterBenchmarkMetrics;
} {
  const caseScores = cases.map((testCase) =>
    scoreCase(testCase, answers[testCase.id] ?? ""),
  );
  const correctness = caseScores.length
    ? caseScores.reduce((total, item) => total + item.score, 0) /
      caseScores.length
    : 0;
  const totalLatencyMs = timing.totalLatencyMs ?? null;
  const completionTokens = timing.completionTokens ?? null;
  return {
    caseScores,
    metrics: {
      correctness,
      instructionFollowing: correctness,
      ttftMs: timing.ttftMs ?? null,
      totalLatencyMs,
      throughputTokensPerSecond:
        completionTokens !== null && totalLatencyMs && totalLatencyMs > 0
          ? (completionTokens * 1000) / totalLatencyMs
          : null,
      tokenUsage: {
        prompt: timing.promptTokens ?? null,
        completion: completionTokens,
        total:
          timing.promptTokens !== null &&
          timing.promptTokens !== undefined &&
          completionTokens !== null
            ? timing.promptTokens + completionTokens
            : null,
      },
      overallScore: correctness,
    },
  };
}
