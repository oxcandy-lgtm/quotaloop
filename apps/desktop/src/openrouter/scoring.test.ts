import { describe, expect, it } from "vitest";
import { OPENROUTER_BENCHMARK_MANIFEST } from "./benchmark-manifest";
import { scoreBenchmark, scoreCase } from "./scoring";

describe("OpenRouter deterministic scoring", () => {
  it("scores exact answers and fenced JSON safely", () => {
    const testCase = OPENROUTER_BENCHMARK_MANIFEST.cases[0]!;
    expect(scoreCase(testCase, '```json\n"東京"\n```').passed).toBe(true);
    expect(scoreCase(testCase, "大阪").passed).toBe(false);
  });
  it("reports bounded metrics without an LLM judge", () => {
    const testCases = OPENROUTER_BENCHMARK_MANIFEST.cases.slice(0, 2);
    const scored = scoreBenchmark(
      testCases,
      { "ja-01": "東京", "ja-02": "7" },
      { totalLatencyMs: 1000, completionTokens: 20 },
    );
    expect(scored.metrics.correctness).toBe(100);
    expect(scored.metrics.throughputTokensPerSecond).toBe(20);
    expect(scored.metrics.trackScores.japanese).toBe(100);
    expect(scored.metrics.trackScores.english).toBe(0);
    expect(scored.metrics.caseCount).toBe(2);
  });
  it("scores instruction adherence separately from token correctness", () => {
    const testCase = OPENROUTER_BENCHMARK_MANIFEST.cases[0]!;
    const scored = scoreBenchmark([testCase], {
      [testCase.id]: "東京です。補足はありません。",
    });
    expect(scored.metrics.correctness).toBe(100);
    expect(scored.metrics.instructionFollowing).toBe(50);
    expect(scored.metrics.overallScore).toBe(85);
  });
});
