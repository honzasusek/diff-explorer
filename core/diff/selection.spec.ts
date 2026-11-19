import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT, sampleDiff, sampleFile } from "../testing/sample.ts";
import { captureFile, captureHunk, captureRef, captureRows, gutterPress } from "./selection.ts";
import type { CodeRef } from "../types.ts";

const diff = sampleDiff();
const file = (path: string) => sampleFile(diff, path);
const shape = (ref: CodeRef | undefined) =>
  ref === undefined ? undefined : [ref.side, ref.start, ref.end, ref.lines.map((l) => l.type)];

test("gutter presses: anchor, complete in either order, clear, start over elsewhere", () => {
  const at = (hunk: number, row: number) => ({ file: CLIENT, hunk, row });
  assert.deepEqual(gutterPress(null, at(0, 3)), { kind: "anchor", anchor: at(0, 3) });
  const range = { kind: "range", file: CLIENT, hunk: 0, from: 1, to: 3 };
  assert.deepEqual(gutterPress(at(0, 3), at(0, 1)), range);
  assert.deepEqual(gutterPress(at(0, 1), at(0, 3)), range);
  assert.deepEqual(gutterPress(at(0, 3), at(0, 3)), { kind: "clear" });
  assert.deepEqual(gutterPress(at(0, 3), at(1, 0)), { kind: "anchor", anchor: at(1, 0) });
  const elsewhere = { file: "README.md", hunk: 0, row: 0 };
  assert.deepEqual(gutterPress(at(0, 3), elsewhere), { kind: "anchor", anchor: elsewhere });
});

test("captureRows takes the rows as drawn, on the new Side when any row has one", () => {
  const ref = captureRows(file(CLIENT), 0, 1, 3);
  assert.deepEqual(shape(ref), ["new", 41, 42, ["del", "add", "add"]]);
  assert.equal(ref?.id, "src/payments/client.ts:new:41-42");
  assert.equal(ref?.file, CLIENT);
  assert.deepEqual(shape(captureRows(file(CLIENT), 0, 1, 1)), ["old", 41, 41, ["del"]]);
  assert.equal(captureRows(file(CLIENT), 5, 0, 0), undefined);
});

test("captureRef by numbers keeps a deleted line between kept ones and drops one before the first", () => {
  const on = (side: "new" | "old", from: number, to: number) => shape(captureRef(diff, { file: CLIENT, side, from, to }));
  assert.deepEqual(on("new", 41, 43), ["new", 41, 43, ["add", "add", "context"]]);
  assert.deepEqual(on("new", 40, 43), ["new", 40, 43, ["context", "del", "add", "add", "context"]]);
  assert.deepEqual(on("old", 41, 42), ["old", 41, 42, ["del", "add", "add", "context"]]);
});

test("captureRef spans hunks and is undefined for lines outside the diff", () => {
  assert.deepEqual(shape(captureRef(diff, { file: CLIENT, side: "new", from: 43, to: 81 })), ["new", 43, 81, ["context", "context"]]);
  assert.equal(captureRef(diff, { file: CLIENT, side: "new", from: 10, to: 20 }), undefined);
  assert.equal(captureRef(diff, { file: "nope.ts", side: "new", from: 1, to: 1 }), undefined);
});

test("captureHunk and captureFile take whole hunks; a file is its changed hunks", () => {
  assert.deepEqual(shape(captureHunk(file(CLIENT), 1)), ["new", 81, 83, ["context", "add", "context"]]);
  assert.deepEqual(shape(captureHunk(file("README.md"), 0)), ["new", 1, 1, ["del", "del", "add"]]);
  assert.equal(captureHunk(file(CLIENT), 2), undefined);
  assert.deepEqual(shape(captureFile(file("src/payments/retry.ts"))), ["new", 1, 3, ["add", "add", "add"]]);
  assert.deepEqual(shape(captureFile(file("LICENSE"))), ["old", 1, 2, ["del", "del"]]);
  const whole = captureFile(file(CLIENT));
  assert.deepEqual([whole?.start, whole?.end, whole?.lines.length], [40, 83, 8]);
  assert.equal(captureFile({ ...file(CLIENT), hunks: [] }), undefined);
});
