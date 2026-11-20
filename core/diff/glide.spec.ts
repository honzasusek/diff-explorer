import { test } from "node:test";
import assert from "node:assert/strict";
import { glide } from "./glide.ts";

test("a page glides in eased steps that end on the target", () => {
  assert.deepEqual(glide(0, 20, 20), [10, 16, 19, 20]);
  assert.deepEqual(glide(40, 20, 20), [30, 24, 21, 20]);
});

test("a short move goes at once", () => {
  assert.deepEqual(glide(10, 12, 20), [12]);
  assert.deepEqual(glide(10, 10, 20), [10]);
});

test("a long jump lands a window short, then glides the last window", () => {
  const steps = glide(0, 1000, 20);
  assert.equal(steps[0], 980);
  assert.equal(steps[steps.length - 1], 1000);
  assert.ok(steps.every((v, i) => i === 0 || v > (steps[i - 1] ?? 0)));
  assert.equal(glide(1000, 0, 20)[0], 20);
});
