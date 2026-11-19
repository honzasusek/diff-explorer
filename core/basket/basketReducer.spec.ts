import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT, sampleDiff, sampleFile } from "../testing/sample.ts";
import { captureFile, captureRef } from "../diff/selection.ts";
import { basketReducer, markStale } from "./basketReducer.ts";
import type { CodeRef } from "../types.ts";

const diff = sampleDiff();
const must = (ref: CodeRef | undefined): CodeRef => {
  if (ref === undefined) throw new Error("no ref");
  return ref;
};
const a = must(captureRef(diff, { file: CLIENT, side: "new", from: 41, to: 42 }));
const b = must(captureFile(sampleFile(diff, "src/payments/retry.ts")));
const span = must(captureRef(diff, { file: CLIENT, side: "new", from: 43, to: 81 }));

test("add keeps one ref per file, Side and range; remove and clear", () => {
  let basket = basketReducer([], { type: "add", ref: a });
  basket = basketReducer(basket, { type: "add", ref: { ...a, lines: [] } });
  basket = basketReducer(basket, { type: "add", ref: b });
  assert.deepEqual(basket.map((r) => r.id), [a.id, b.id]);
  assert.equal(basket[0], a);
  assert.deepEqual(basketReducer(basket, { type: "remove", id: a.id }).map((r) => r.id), [b.id]);
  assert.deepEqual(basketReducer(basket, { type: "clear" }), []);
});

test("markStale names the refs whose lines the diff no longer holds", () => {
  const basket = [a, b, span];
  assert.deepEqual(markStale(basket, diff), []);

  const edited = structuredClone(diff);
  edited.files[0]!.hunks[0]!.lines[3]!.content = "    return retry(() => charge(url, opts), 3);";
  assert.deepEqual(markStale(basket, edited), [a.id]);

  const shifted = structuredClone(diff);
  for (const line of shifted.files[0]!.hunks[0]!.lines) if (line.newNo !== null) line.newNo += 1;
  assert.deepEqual(markStale(basket, shifted), [a.id, span.id]);

  const gone = { ...diff, files: diff.files.filter((f) => f.path !== b.file) };
  assert.deepEqual(markStale(basket, gone), [b.id]);
});
