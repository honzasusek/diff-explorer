import assert from "node:assert/strict";
import { test } from "node:test";

import type { Diff, DiffFile, DiffLine, Hunk } from "../types.ts";
import { hunksNear, layoutDiff } from "./layout.ts";

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

test("layout counts head, list, file headers and hunk rows", () => {
  const layout = layoutDiff(diff, new Set(), 2);
  assert.deepEqual(
    layout.files.map((f) => [f.key, f.top, f.rows, f.hunks.map((h) => [h.key, h.top, h.rows])]),
    [
      ["file:a", 5, 11, [["hunk:a:0", 6, 4], ["hunk:a:1", 10, 6]]],
      ["file:b", 16, 1, []],
      ["file:c", 17, 12, [["hunk:c:0", 18, 11]]],
    ],
  );
  assert.equal(layout.rows, 29);
});

test("a folded file keeps its header row and nothing else", () => {
  const layout = layoutDiff(diff, new Set(["a"]), 2);
  assert.deepEqual(layout.files.map((f) => [f.top, f.rows]), [[5, 1], [6, 1], [7, 12]]);
  assert.equal(layout.rows, 19);
});

test("hunksNear picks the hunks crossing the widened window, in order", () => {
  const layout = layoutDiff(diff, new Set(), 2);
  const keys = (window: { offset: number; bodyRows: number }) => hunksNear(layout, window).map((h) => h.key);
  assert.deepEqual(keys({ offset: 0, bodyRows: 4 }), ["hunk:a:0", "hunk:a:1"]);
  assert.deepEqual(keys({ offset: 0, bodyRows: 2 }), []);
  assert.deepEqual(keys({ offset: 17, bodyRows: 2 }), ["hunk:a:1", "hunk:c:0"]);
  assert.deepEqual(keys({ offset: 20, bodyRows: 2 }), ["hunk:c:0"]);
  assert.deepEqual(keys({ offset: 100, bodyRows: 2 }), []);
});
