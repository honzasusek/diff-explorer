import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff } from "./parser.ts";
import { quotePath, renderHunk, renderHunkHeader, renderPatch } from "./patchRenderer.ts";
import { FIXTURES, fixture } from "../testing/fixtures.ts";

test("every fixture survives parse, render, parse", () => {
  for (const name of FIXTURES) {
    const parsed = parseUnifiedDiff(fixture(name));
    const again = parseUnifiedDiff(parsed.map(renderPatch).join(""));
    assert.deepEqual(again, parsed, name);
  }
});

test("hunk headers follow git's short forms", () => {
  assert.equal(renderHunkHeader({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, header: "", lines: [] }), "@@ -1 +1 @@");
  assert.equal(renderHunkHeader({ oldStart: 1, oldLines: 5, newStart: 1, newLines: 5, header: "fn()", lines: [] }), "@@ -1,5 +1,5 @@ fn()");
  assert.equal(renderHunkHeader({ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0, header: "", lines: [] }), "@@ -1 +0,0 @@");
});

test("a hunk renders its markers and the no-newline note", () => {
  const [file] = parseUnifiedDiff(fixture("no-newline"));
  assert.equal(
    renderHunk(file!.hunks[0]!),
    ["@@ -1 +1 @@", "-no newline", "\\ No newline at end of file", "+no newline changed", "\\ No newline at end of file"].join("\n"),
  );
});

test("paths are quoted only when git would quote them", () => {
  assert.equal(quotePath("café file.txt"), "café file.txt");
  assert.equal(quotePath('odd"name.txt'), '"odd\\"name.txt"');
  assert.equal(quotePath("tab\tname"), '"tab\\tname"');
  assert.equal(quotePath("back\\slash"), '"back\\\\slash"');
  assert.equal(quotePath("bell\x07"), '"bell\\007"');
});

test("a quoted path round-trips through the parser", () => {
  const [file] = parseUnifiedDiff(fixture("modified-two-hunks"));
  const odd = { ...file!, oldPath: 'we"ird\t.txt', newPath: 'we"ird\t.txt', path: 'we"ird\t.txt' };
  const [back] = parseUnifiedDiff(renderPatch(odd));
  assert.deepEqual([back!.oldPath, back!.newPath, back!.hunks.length], ['we"ird\t.txt', 'we"ird\t.txt', 2]);
});
