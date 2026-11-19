import assert from "node:assert/strict";
import { test } from "node:test";

import { isInside, recentFor, recentReviews, remember } from "./recent.ts";

const pay = { target: { kind: "pr" as const, number: 412 }, baseRef: null };
const web = { target: { kind: "worktree" as const }, baseRef: "main" };

test("isInside takes the directory itself and what lies under it, not a sibling with the same prefix", () => {
  assert.equal(isInside("/a", "/a"), true);
  assert.equal(isInside("/a/b", "/a"), true);
  assert.equal(isInside("/a/b", "/a/"), true);
  assert.equal(isInside("/ab", "/a"), false);
  assert.equal(isInside("/", "/a"), false);
});

test("recentFor picks the record of the repository holding the directory, the deepest when nested", () => {
  const recent = remember(remember({}, "/work/pay", pay), "/work/pay/web", web);
  assert.deepEqual(recentFor(recent, "/work/pay"), pay);
  assert.deepEqual(recentFor(recent, "/work/pay/src"), pay);
  assert.deepEqual(recentFor(recent, "/work/pay/web/app"), web);
  assert.equal(recentFor(recent, "/work/payroll"), undefined);
  assert.equal(recentFor({}, "/work/pay"), undefined);
});

test("recentReviews reads back only well-formed entries", () => {
  const stored = JSON.parse(JSON.stringify({ "/work/pay": pay, "/bad": { target: { kind: "pr" } }, "/worse": 3 }));
  assert.deepEqual(recentReviews(stored), { "/work/pay": pay });
  assert.deepEqual(recentReviews(undefined), {});
  assert.deepEqual(recentReviews([pay]), {});
});
