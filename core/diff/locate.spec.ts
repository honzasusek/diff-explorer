import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT, sampleDiff } from "../testing/sample.ts";
import { locateText } from "./locate.ts";
import type { Located } from "./locate.ts";

const diff = sampleDiff();
const where = (found: Located) =>
  found.kind === "located"
    ? [found.at.file.path, found.at.hunk, found.at.from, found.at.to]
    : found.kind === "ambiguous"
      ? found.candidates.map((c) => [c.file.path, c.hunk, c.from, c.to])
      : found.kind;

test("whole lines locate their rows, a trailing newline and spaces ignored", () => {
  const text = "  if (!res.ok && retryable(res)) {\n    return retry(() => charge(url, opts));   \n";
  assert.deepEqual(where(locateText(diff, text)), [CLIENT, 0, 2, 3]);
  assert.deepEqual(where(locateText(diff, "  return fn();   \n")), ["src/payments/retry.ts", 0, 1, 1]);
});

test("a drag may begin and end mid-line", () => {
  assert.deepEqual(where(locateText(diff, "retryable(res)) {\n    return retry(() => charge")), [CLIENT, 0, 2, 3]);
  assert.deepEqual(where(locateText(diff, "retry(() =>")), [CLIENT, 0, 3, 3]);
  assert.deepEqual(where(locateText(diff, "fetch(url, opts);\n  if (!res.ok) throw")), [CLIENT, 0, 0, 1]);
});

test("a line found in two files is ambiguous unless the hint settles it", () => {
  const text = "  return res.json();";
  assert.deepEqual(where(locateText(diff, text)), [[CLIENT, 0, 4, 4], ["README.md", 0, 1, 1]]);
  assert.deepEqual(where(locateText(diff, text, { file: "README.md" })), ["README.md", 0, 1, 1]);
  assert.deepEqual(where(locateText(diff, text, { file: "LICENSE" })), [[CLIENT, 0, 4, 4], ["README.md", 0, 1, 1]]);
});

test("nothing, blanks and foreign text are not found", () => {
  assert.equal(locateText(diff, "").kind, "notFound");
  assert.equal(locateText(diff, "\n  \n").kind, "notFound");
  assert.equal(locateText(diff, "nothing like this").kind, "notFound");
  assert.equal(locateText(diff, "  if (!res.ok && retryable(res)) {\n  return res.json();").kind, "notFound");
});
