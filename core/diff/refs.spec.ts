import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT, sampleDiff, sampleFile } from "../testing/sample.ts";
import { hunkOfRef, matchFiles, parseRefToken, refLabel, refName, refsInText, renderRefs, suggestRefs } from "./refs.ts";
import { captureFile, captureRef, captureRows } from "./selection.ts";
import type { CodeRef } from "../types.ts";

const diff = sampleDiff();
const file = (path: string) => sampleFile(diff, path);
const newRef = (from: number, to: number): CodeRef => {
  const ref = captureRef(diff, { file: CLIENT, side: "new", from, to });
  if (ref === undefined) throw new Error(`no ref ${from}-${to}`);
  return ref;
};

test("refLabel is the basename and the range, with the old Side named", () => {
  assert.equal(refLabel(newRef(41, 42)), "client.ts:41-42");
  assert.equal(refLabel(newRef(41, 41)), "client.ts:41");
  assert.equal(refLabel(captureFile(file("LICENSE"))!), "LICENSE:1-2 (old)");
  assert.equal(refName(newRef(41, 42)), "src/payments/client.ts:41-42");
});

test("renderRefs writes numbered code_ref blocks, r1, r2, ... with a blank line between", () => {
  const rows = captureRows(file(CLIENT), 0, 1, 3)!;
  assert.equal(
    renderRefs([rows]),
    [
      '<code_ref id="r1" file="src/payments/client.ts" side="new" lines="41-42">',
      "   -|   if (!res.ok) throw new Error(res.status);",
      "41 +|   if (!res.ok && retryable(res)) {",
      "42 +|     return retry(() => charge(url, opts));",
      "</code_ref>",
    ].join("\n"),
  );
  const two = renderRefs([rows, captureFile(file("LICENSE"))!]);
  assert.ok(two.includes('</code_ref>\n\n<code_ref id="r2" file="LICENSE" side="old" lines="1-2">\n1 -| MIT\n2 -| Copyright\n</code_ref>'));
  assert.equal(renderRefs([]), "");
});

test("matchFiles: exact path, then a path suffix, then a substring", () => {
  assert.deepEqual(matchFiles(diff, "README.md").map((f) => f.path), ["README.md"]);
  assert.deepEqual(matchFiles(diff, "client.ts").map((f) => f.path), [CLIENT]);
  assert.deepEqual(matchFiles(diff, "Payments").map((f) => f.path), [CLIENT, "src/payments/retry.ts"]);
  assert.deepEqual(matchFiles(diff, "nope"), []);
});

test("parseRefToken reads #path, #path:line and #path:from-to, and explains a miss", () => {
  assert.equal(parseRefToken("#client.ts:41-43", diff).ref?.id, "src/payments/client.ts:new:41-43");
  assert.equal(parseRefToken("#client.ts:43-41", diff).ref?.id, "src/payments/client.ts:new:41-43");
  assert.equal(parseRefToken("#retry.ts", diff).ref?.id, "src/payments/retry.ts:new:1-3");
  assert.equal(parseRefToken("payments/client.ts:41", diff).ref?.id, "src/payments/client.ts:new:41-41");
  assert.equal(parseRefToken("README.md:1-2", diff, "old").ref?.id, "README.md:old:1-2");
  assert.equal(parseRefToken("#nope.ts", diff).error, "No file in the diff matches nope.ts");
  assert.equal(parseRefToken("#payments", diff).error, "payments matches several files: src/payments/client.ts, src/payments/retry.ts");
  assert.equal(parseRefToken("#client.ts:1-2", diff).error, "src/payments/client.ts has no new lines 1-2 in the diff");
  assert.equal(parseRefToken("#client.ts:7", diff).error, "src/payments/client.ts has no new line 7 in the diff");
  assert.match(parseRefToken("#", diff).error ?? "", /^Not a ref/);
  assert.match(parseRefToken("a:b", diff).error ?? "", /^Not a ref/);
});

test("suggestRefs offers paths, then one file's hunks as ranges; every row parses", () => {
  assert.deepEqual(suggestRefs(diff, "#cli"), ["#src/payments/client.ts"]);
  assert.deepEqual(suggestRefs(diff, "#README"), ["#README.md"]);
  assert.deepEqual(suggestRefs(diff, "#"), ["#src/payments/client.ts", "#src/payments/retry.ts", "#README.md", "#LICENSE"]);
  assert.deepEqual(suggestRefs(diff, "#src/payments/client.ts"), ["#src/payments/client.ts:40-43", "#src/payments/client.ts:81-83"]);
  assert.deepEqual(suggestRefs(diff, "#cli:8"), ["#src/payments/client.ts:81-83"]);
  assert.deepEqual(suggestRefs(diff, "#README.md:"), ["#README.md:1"]);
  assert.deepEqual(suggestRefs(diff, "#LICENSE:"), []);
  assert.deepEqual(suggestRefs(diff, "#zzz"), []);
  assert.deepEqual(suggestRefs(diff, "#", 2), ["#src/payments/client.ts", "#src/payments/retry.ts"]);
  for (const token of ["#", "#cli", "#src/payments/client.ts", "#README.md:"]) {
    for (const row of suggestRefs(diff, token)) assert.ok(parseRefToken(row, diff).ref, `${row} parses`);
  }
});

test("hunkOfRef finds the hunk holding the ref's first line", () => {
  assert.deepEqual(hunkOfRef(diff, newRef(82, 82)), { file: file(CLIENT), hunk: 1 });
  assert.deepEqual(hunkOfRef(diff, { ...newRef(41, 42), start: 999 }), { file: file(CLIENT), hunk: null });
  assert.equal(hunkOfRef(diff, { ...newRef(41, 42), file: "nope" }), undefined);
});

test("refsInText picks the #path:from-to tokens of a prompt, once each, and reports a bad range", () => {
  const text = "why #client.ts:41-43 and #retry.ts, see #client.ts:41-43 again; issue #412, #nope.ts:3 and #x:y";
  const found = refsInText(diff, text);
  assert.deepEqual(found.refs.map((r) => r.id), ["src/payments/client.ts:new:41-43", "src/payments/retry.ts:new:1-3"]);
  assert.deepEqual(found.errors, ["No file in the diff matches nope.ts"]);
  assert.deepEqual(refsInText(diff, "no refs here, a#b neither"), { refs: [], errors: [] });
});

test("a stale ref's block says so in its tag", () => {
  const ref = newRef(41, 42);
  assert.ok(renderRefs([ref]).startsWith('<code_ref id="r1" file="src/payments/client.ts" side="new" lines="41-42">\n'));
  assert.ok(renderRefs([ref], new Set([ref.id])).startsWith('<code_ref id="r1" file="src/payments/client.ts" side="new" lines="41-42" stale="true">\n'));
  assert.ok(renderRefs([ref], new Set(["other"])).startsWith('<code_ref id="r1" file="src/payments/client.ts" side="new" lines="41-42">\n'));
});
