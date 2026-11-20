import { test } from "node:test";
import assert from "node:assert/strict";
import { codeRows, textWidth, wrapWords } from "./wrap.ts";

// The cases below are the ones measured in a session: 71 body columns, a
// hunk whose widest number has 3 digits leaves 65 cells for code.
test("code wraps by character, an exact fit staying on one row", () => {
  assert.equal(codeRows("", 65), 1);
  assert.equal(codeRows("x".repeat(65), 65), 1);
  assert.equal(codeRows("x".repeat(66), 65), 2);
  assert.equal(codeRows("x".repeat(150), 65), 3);
  assert.equal(codeRows("y".repeat(70), 64), 2);
  assert.equal(codeRows("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon", 65), 2);
});

test("a wide character counts two cells and moves whole to the next row", () => {
  assert.equal(textWidth("漢字a"), 5);
  const wide = "// " + "漢字かなカナ".repeat(6) + " end";
  assert.equal(codeRows(wide, 65), 2);
  assert.equal(codeRows("a" + "漢".repeat(2), 4), 2);
});

test("a leading tab takes two cells, a later one runs to the next multiple of eight", () => {
  // "\t\tif ..." drew four blanks, then 61 characters on the first row.
  const tabbed = "\t\tif (x) { return aVeryLongIdentifierNameThatGoesOnAndOn + anotherVeryLongIdentifierName }";
  assert.equal(codeRows(tabbed, 65), 2);
  assert.equal(codeRows("\t\t\t" + "y".repeat(61), 67), 1);
  assert.equal(codeRows("\t\t\t" + "y".repeat(62), 67), 2);
  assert.equal(codeRows("abcdefg\th", 9), 1);
  assert.equal(codeRows("abcdefg\th", 8), 2);
});

test("header text breaks at spaces, a long word where it must", () => {
  assert.deepEqual(wrapWords("M src/a.ts +2 -1", 10), ["M src/a.ts", "+2 -1"]);
  assert.deepEqual(wrapWords("short", 10), ["short"]);
  assert.deepEqual(wrapWords("M src/payments/client.ts", 10), ["M", "src/paymen", "ts/client.", "ts"]);
  assert.deepEqual(wrapWords("aaaa bbbb cccc", 9), ["aaaa bbbb", "cccc"]);
  assert.deepEqual(wrapWords("", 10), [""]);
});
