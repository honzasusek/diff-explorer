import assert from "node:assert/strict";
import { test } from "node:test";

import type { Diff, DiffFile, DiffLine, Hunk } from "../types.ts";
import { hunksNear, layoutDiff } from "./layout.ts";
import type { RowMeasure } from "./layout.ts";

function hunk(lines: number): Hunk {
  const body: DiffLine[] = Array.from({ length: lines }, (_, i) => ({ type: "context", content: `l${i}`, oldNo: i + 1, newNo: i + 1 }));
  return { oldStart: 1, oldLines: lines, newStart: 1, newLines: lines, header: "", lines: body };
}

function file(id: string, hunks: Hunk[], binary = false): DiffFile {
  return { id, oldPath: id, newPath: id, path: id, status: "modified", binary, additions: 0, deletions: 0, hunks };
}

const diff: Diff = {
  files: [file("a", [hunk(3), hunk(5)]), file("b", [], true), file("c", [hunk(10)])],
  additions: 0,
  deletions: 0,
};

test("layout counts head, file headers and hunk rows", () => {
  const layout = layoutDiff(diff, new Set(), 2);
  assert.deepEqual(
    layout.files.map((f) => [f.key, f.top, f.rows, f.hunks.map((h) => [h.key, h.top, h.rows])]),
    [
      ["file:a", 2, 11, [["hunk:a:0", 3, 4], ["hunk:a:1", 7, 6]]],
      ["file:b", 13, 1, []],
      ["file:c", 14, 12, [["hunk:c:0", 15, 11]]],
    ],
  );
  assert.equal(layout.rows, 26);
});

test("a folded file keeps its header row and nothing else", () => {
  const layout = layoutDiff(diff, new Set(["a"]), 2);
  assert.deepEqual(layout.files.map((f) => [f.top, f.rows]), [[2, 1], [3, 1], [4, 12]]);
  assert.equal(layout.rows, 16);
});

test("hunksNear picks the hunks crossing the widened window, in order", () => {
  const layout = layoutDiff(diff, new Set(), 2);
  const keys = (window: { offset: number; bodyRows: number }) => hunksNear(layout, window).map((h) => h.key);
  assert.deepEqual(keys({ offset: 0, bodyRows: 4 }), ["hunk:a:0", "hunk:a:1"]);
  assert.deepEqual(keys({ offset: 0, bodyRows: 2 }), ["hunk:a:0"]);
  assert.deepEqual(keys({ offset: 14, bodyRows: 2 }), ["hunk:a:1", "hunk:c:0"]);
  assert.deepEqual(keys({ offset: 20, bodyRows: 2 }), ["hunk:c:0"]);
  assert.deepEqual(keys({ offset: 100, bodyRows: 2 }), []);
});

test("a measure that wraps grows the headers, the lines and every row after them", () => {
  // A's header takes 2 rows, its first hunk's header 2, and line 1 of every hunk 3.
  const wrapping: RowMeasure = {
    fileHeader: (f) => (f.id === "a" ? 2 : 1),
    hunkHeader: (f, h) => (f.id === "a" && h === f.hunks[0] ? 2 : 1),
    body: (h) => h.lines.map((_, i) => (i === 1 ? 3 : 1)),
  };
  const layout = layoutDiff(diff, new Set(), 2, wrapping);
  assert.deepEqual(
    layout.files.map((f) => [f.top, f.headerRows, f.hunks.map((h) => [h.top, h.rows, h.headerRows, h.bodyRows])]),
    [
      [2, 2, [[4, 7, 2, [1, 3, 1]], [11, 8, 1, [1, 3, 1, 1, 1]]]],
      [19, 1, []],
      [20, 1, [[21, 13, 1, [1, 3, 1, 1, 1, 1, 1, 1, 1, 1]]]],
    ],
  );
  assert.equal(layout.rows, 34);
  // Folded, a file keeps only its header, at the height the measure gives it.
  assert.deepEqual(layoutDiff(diff, new Set(["a"]), 2, wrapping).files.map((f) => [f.top, f.rows]), [[2, 2], [4, 1], [5, 14]]);
});
