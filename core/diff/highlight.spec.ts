import assert from "node:assert/strict";
import { test } from "node:test";

import { highlightLine, isHighlighted } from "./highlight.ts";

const kinds = (line: string, state: "code" | "block" | "template" = "code") =>
  highlightLine(line, state).pieces.map(p => [p.kind, p.text]);

test("keywords, numbers and comments are told apart from plain code", () => {
  assert.deepEqual(kinds("const n = 4 // four"), [
    ["keyword", "const"],
    [null, " n = "],
    ["number", "4"],
    [null, " "],
    ["comment", "// four"],
  ]);
});

test("keywords with only spaces between are one piece, and a property named like a keyword is plain", () => {
  assert.deepEqual(kinds("export const x = a.type"), [
    ["keyword", "export const"],
    [null, " x = a.type"],
  ]);
});

test("strings keep their escapes and a digit inside a name is no number", () => {
  assert.deepEqual(kinds(`f('it\\'s', v2)`), [
    [null, "f("],
    ["string", "'it\\'s'"],
    [null, ", v2)"],
  ]);
});

test("a block comment and a template string carry over to the next line", () => {
  const first = highlightLine("x /* open", "code");
  assert.equal(first.state, "block");
  assert.deepEqual(kinds("still */ return", first.state), [
    ["comment", "still */"],
    [null, " "],
    ["keyword", "return"],
  ]);
  const template = highlightLine("const s = `a", "code");
  assert.equal(template.state, "template");
  assert.deepEqual(highlightLine("b` + 1", "template").pieces[0], { text: "b`", kind: "string" });
});

test("only TypeScript files are coloured", () => {
  assert.equal(isHighlighted("src/a.ts"), true);
  assert.equal(isHighlighted("src/App.tsx"), true);
  assert.equal(isHighlighted("src/a.js"), false);
});
