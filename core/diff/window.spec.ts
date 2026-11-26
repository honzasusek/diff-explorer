import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiffLine, Hunk } from "../types.ts";
import { renderHunkHeader } from "./patchRenderer.ts";
import { cut, subHunk } from "./window.ts";

const ctx = (content: string, oldNo: number, newNo: number): DiffLine => ({ type: "context", content, oldNo, newNo });
const del = (content: string, oldNo: number): DiffLine => ({ type: "del", content, oldNo, newNo: null });
const add = (content: string, newNo: number): DiffLine => ({ type: "add", content, oldNo: null, newNo });

test("a window cuts the pieces it shows, with the rows of the first above its top", () => {
  assert.deepEqual(cut([1, 3, 1, 1], 2, 5), { first: 1, above: 1, end: 3 });
  assert.deepEqual(cut([1, 3, 1, 1], 0, 1), { first: 0, above: 0, end: 1 });
  assert.deepEqual(cut([1, 3, 1, 1], 4, 100), { first: 2, above: 0, end: 4 });
  assert.deepEqual(cut([1, 3, 1, 1], 6, 9), { first: 4, above: 0, end: 4 });
});

test("a slice of a hunk numbers its lines as the whole hunk does", () => {
  const hunk: Hunk = {
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 4,
    header: "f()",
    lines: [ctx("a", 1, 1), del("b", 2), add("B", 2), add("C", 3), ctx("d", 3, 4)],
  };
  assert.equal(renderHunkHeader(subHunk(hunk, 1, 3)), "@@ -2 +2 @@ f()");
  // Only added lines: the old side starts at the last old line before them.
  assert.equal(renderHunkHeader(subHunk(hunk, 2, 4)), "@@ -2,0 +2,2 @@ f()");
  assert.equal(renderHunkHeader(subHunk(hunk, 0, 5)), "@@ -1,3 +1,4 @@ f()");
  const added: Hunk = { oldStart: 1, oldLines: 0, newStart: 1, newLines: 3, header: "", lines: [add("x", 1), add("y", 2), add("z", 3)] };
  assert.equal(renderHunkHeader(subHunk(added, 1, 3)), "@@ -1,0 +2,2 @@");
});
