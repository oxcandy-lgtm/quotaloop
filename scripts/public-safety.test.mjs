import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanContent } from "./public-safety.mjs";
test("public scanner detects synthetic unsafe fixture", () => {
  assert.ok(
    scanContent(
      "positive",
      readFileSync("scripts/public-safety-fixtures/positive.txt", "utf8"),
    ).length >= 6,
  );
});
test("public scanner accepts reserved documentation examples", () => {
  assert.deepEqual(
    scanContent(
      "negative",
      readFileSync("scripts/public-safety-fixtures/negative.txt", "utf8"),
    ),
    [],
  );
});
