import type {
  OpenRouterBenchmarkCase,
  OpenRouterBenchmarkManifest,
} from "@quotaloop/contracts";
import { stableHash } from "./catalog";

export const OPENROUTER_MANIFEST_ID =
  "quotaloop.openrouter.free-benchmark.v1" as const;
export const OPENROUTER_SYSTEM_PROMPT =
  "Answer exactly and concisely. Do not mention this benchmark.";

const cases: OpenRouterBenchmarkCase[] = [
  {
    id: "ja-01",
    kind: "japanese",
    language: "ja",
    prompt: "日本の首都を一語で答えてください。",
    expectedAnswer: "東京",
    expectedTokens: ["東京"],
  },
  {
    id: "ja-02",
    kind: "japanese",
    language: "ja",
    prompt: "3 + 4 の答えを数字だけで答えてください。",
    expectedAnswer: "7",
    expectedTokens: ["7"],
  },
  {
    id: "ja-03",
    kind: "japanese",
    language: "ja",
    prompt: "水が凍る温度を摂氏の数字だけで答えてください。",
    expectedAnswer: "0",
    expectedTokens: ["0"],
  },
  {
    id: "ja-04",
    kind: "japanese",
    language: "ja",
    prompt: "「はい」を日本語で一語だけ書いてください。",
    expectedAnswer: "はい",
    expectedTokens: ["はい"],
  },
  {
    id: "en-01",
    kind: "english",
    language: "en",
    prompt: "Reply with the capital of France only.",
    expectedAnswer: "Paris",
    expectedTokens: ["paris"],
  },
  {
    id: "en-02",
    kind: "english",
    language: "en",
    prompt: "Reply with 5 + 6 as digits only.",
    expectedAnswer: "11",
    expectedTokens: ["11"],
  },
  {
    id: "en-03",
    kind: "english",
    language: "en",
    prompt: "Reply with the word blue only.",
    expectedAnswer: "blue",
    expectedTokens: ["blue"],
  },
  {
    id: "en-04",
    kind: "english",
    language: "en",
    prompt: "Reply with exactly three words: local first software.",
    expectedAnswer: "local first software",
    expectedTokens: ["local", "first", "software"],
  },
  {
    id: "code-01",
    kind: "coding",
    language: "en",
    prompt: "Return only the JavaScript expression that adds x and y.",
    expectedAnswer: "x + y",
    expectedTokens: ["x", "+", "y"],
  },
  {
    id: "code-02",
    kind: "coding",
    language: "en",
    prompt: "Return only the Python keyword used to define a function.",
    expectedAnswer: "def",
    expectedTokens: ["def"],
  },
  {
    id: "code-03",
    kind: "coding",
    language: "en",
    prompt: "Return only the JSON boolean for true.",
    expectedAnswer: "true",
    expectedTokens: ["true"],
  },
  {
    id: "code-04",
    kind: "coding",
    language: "en",
    prompt: "Return only the TypeScript type for text.",
    expectedAnswer: "string",
    expectedTokens: ["string"],
  },
];

const canonicalManifest = JSON.stringify({
  manifestId: OPENROUTER_MANIFEST_ID,
  systemPrompt: OPENROUTER_SYSTEM_PROMPT,
  cases,
});

export const OPENROUTER_BENCHMARK_MANIFEST: OpenRouterBenchmarkManifest =
  Object.freeze({
    manifestId: OPENROUTER_MANIFEST_ID,
    manifestHash: stableHash(canonicalManifest),
    promptHash: stableHash(OPENROUTER_SYSTEM_PROMPT),
    systemPrompt: OPENROUTER_SYSTEM_PROMPT,
    cases: Object.freeze(cases.map((item) => Object.freeze(item))),
  }) as unknown as OpenRouterBenchmarkManifest;

export const benchmarkCasesByKind = (kind: OpenRouterBenchmarkCase["kind"]) =>
  OPENROUTER_BENCHMARK_MANIFEST.cases.filter((item) => item.kind === kind);

export const benchmarkManifestCanonicalBytes = () => canonicalManifest;
