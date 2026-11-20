import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiffLine, Hunk } from "../types.ts";
import { sideDigits, sideSource, splitHunk } from "./split.ts";

const ctx = (content: string, oldNo: number, newNo: number): DiffLine => ({ type: "context", content, oldNo, newNo });
const del = (content: string, oldNo: number): DiffLine => ({ type: "del", content, oldNo, newNo: null });
const add = (content: string, newNo: number): DiffLine => ({ type: "add", content, oldNo: null, newNo });

// The sample from split.ts: ` a`, `-b`, `-c`, `+B`, ` d`, `+e`.
const sample: Hunk = {
  oldStart: 8,
  oldLines: 4,
  newStart: 9,
  newLines: 4,
  header: "",
  lines: [ctx("a", 8, 9), del("b", 9), del("c", 10), add("B", 10), ctx("d", 11, 11), add("e", 12)],
};

test("a hunk splits into context blocks and changes, each deletion run beside the additions after it", () => {
  assert.deepEqual(splitHunk(sample), [
    { kind: "context", left: [0], right: [0] },
    { kind: "change", left: [1, 2], right: [3] },
    { kind: "context", left: [4], right: [4] },
    { kind: "change", left: [], right: [5] },
  ]);
});

test("a deletion after additions starts a new change", () => {
  const lines = [del("a", 1), add("A", 1), del("b", 2), add("B", 2)];
  assert.deepEqual(splitHunk({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, header: "", lines }), [
    { kind: "change", left: [0], right: [1] },
    { kind: "change", left: [2], right: [3] },
  ]);
});

test("each side of a block is a hunk numbered with that side's own numbers", () => {
  assert.equal(sideSource(sample, [0], "old"), "@@ -8,1 +8,1 @@\n a");
  assert.equal(sideSource(sample, [0], "new"), "@@ -9,1 +9,1 @@\n a");
  assert.equal(sideSource(sample, [1, 2], "old"), "@@ -9,2 +9,0 @@\n-b\n-c");
  assert.equal(sideSource(sample, [3], "new"), "@@ -10,0 +10,1 @@\n+B");
  assert.equal(sideSource(sample, [], "old"), "");
});

test("a side's digits are those of its widest number", () => {
  assert.equal(sideDigits(sample, [1, 2], "old"), 2);
  assert.equal(sideDigits(sample, [], "new"), 1);
});
