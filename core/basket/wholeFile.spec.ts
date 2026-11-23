import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodeRef, Diff, DiffLine } from "../types.ts";
import { isWholeFileFresh } from "./wholeFile.ts";

const ctx = (content: string, oldNo: number, newNo: number): DiffLine => ({ type: "context", content, oldNo, newNo });
const del = (content: string, oldNo: number): DiffLine => ({ type: "del", content, oldNo, newNo: null });
const add = (content: string, newNo: number): DiffLine => ({ type: "add", content, oldNo: null, newNo });

// The sample from wholeFile.ts: a, -b, +B, c, d.
const lines = [ctx("a", 1, 1), del("b", 2), add("B", 2), ctx("c", 3, 3), ctx("d", 4, 4)];
const ref: CodeRef = { id: "f.ts:new:1-4", file: "f.ts", side: "new", start: 1, end: 4, lines, whole: true };

function diffOf(shown: DiffLine[]): Diff {
  const hunk = { oldStart: 2, oldLines: 2, newStart: 2, newLines: 2, header: "", lines: shown };
  const file = { id: "f", oldPath: "f.ts", newPath: "f.ts", path: "f.ts", status: "modified" as const, binary: false, additions: 0, deletions: 0, hunks: [hunk] };
  return { files: [file], additions: 0, deletions: 0 };
}

test("a whole-file ref is fresh while the Diff's lines stand in it", () => {
  assert.equal(isWholeFileFresh(ref, diffOf([del("b", 2), add("B", 2), ctx("c", 3, 3)])), true);
});

test("a change the ref lacks, or one it holds that is gone, makes it stale", () => {
  assert.equal(isWholeFileFresh(ref, diffOf([del("b", 2), add("B", 2), ctx("c", 3, 3), del("d", 4), add("D", 4)])), false);
  assert.equal(isWholeFileFresh(ref, diffOf([])), false);
  assert.equal(isWholeFileFresh({ ...ref, file: "gone.ts" }, diffOf([del("b", 2), add("B", 2)])), false);
});

test("a line above that moves the numbers makes it stale", () => {
  assert.equal(isWholeFileFresh(ref, diffOf([del("b", 2), add("B", 2), add("new", 3), ctx("c", 3, 4)])), false);
});
