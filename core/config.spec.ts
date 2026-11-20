import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, readConfig } from "./config.ts";

test("the stored values are read, trimmed and bounded", () => {
  assert.deepEqual(readConfig({ baseRef: " develop ", foldLines: 2, inlineRows: 12 }), {
    baseRef: "develop",
    foldLines: 2,
    inlineRows: 12,
  });
  assert.deepEqual(readConfig({ baseRef: "", foldLines: 0, inlineRows: 0 }), { baseRef: null, foldLines: 0, inlineRows: null });
});

test("a value that cannot be used falls back to its default", () => {
  assert.deepEqual(readConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(readConfig({ baseRef: "--force", foldLines: -1, inlineRows: 2.5 }), DEFAULT_CONFIG);
  assert.deepEqual(readConfig({ baseRef: 3, foldLines: "x", inlineRows: true }), DEFAULT_CONFIG);
  assert.deepEqual(readConfig({ foldLines: "20", inlineRows: "8" }), { baseRef: null, foldLines: 20, inlineRows: 8 });
});
