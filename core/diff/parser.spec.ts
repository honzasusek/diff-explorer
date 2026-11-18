import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiff, cUnquote, parseUnifiedDiff } from "./parser.ts";
import { fixture, type FixtureName } from "../testing/fixtures.ts";

function one(name: FixtureName) {
  const files = parseUnifiedDiff(fixture(name));
  assert.equal(files.length, 1, `${name} parses to one file`);
  return files[0]!;
}

test("modified file with two hunks", () => {
  const file = one("modified-two-hunks");
  assert.equal(file.status, "modified");
  assert.equal(file.path, "multi.txt");
  assert.deepEqual([file.additions, file.deletions], [2, 2]);
  assert.equal(file.hunks.length, 2);
  const second = file.hunks[1]!;
  assert.deepEqual([second.oldStart, second.oldLines, second.newStart, second.newLines], [8, 5, 8, 5]);
  assert.equal(second.header, "line7");
  assert.deepEqual(
    second.lines.map((l) => [l.type, l.oldNo, l.newNo]),
    [
      ["context", 8, 8],
      ["context", 9, 9],
      ["context", 10, 10],
      ["del", 11, null],
      ["add", null, 11],
      ["context", 12, 12],
    ],
  );
});

test("missing trailing newline is marked on both sides", () => {
  const file = one("no-newline");
  const lines = file.hunks[0]!.lines;
  assert.deepEqual(
    lines.map((l) => [l.type, l.content, l.noNewline]),
    [
      ["del", "no newline", true],
      ["add", "no newline changed", true],
    ],
  );
});

test("pure rename has no hunks", () => {
  const file = one("rename-pure");
  assert.equal(file.status, "renamed");
  assert.deepEqual([file.oldPath, file.newPath, file.path], ["renamed-src.txt", "renamed-dst.txt", "renamed-dst.txt"]);
  assert.deepEqual(file.hunks, []);
});

test("rename with changes keeps its hunk", () => {
  const file = one("rename-modified");
  assert.equal(file.status, "renamed");
  assert.deepEqual([file.oldPath, file.newPath], ["moved-src.txt", "moved-dst.txt"]);
  assert.equal(file.hunks.length, 1);
  assert.deepEqual([file.additions, file.deletions], [1, 0]);
  assert.equal(file.hunks[0]!.header, "keep");
});

test("copy", () => {
  const file = one("copy");
  assert.equal(file.status, "copied");
  assert.deepEqual([file.oldPath, file.newPath], ["copy-src.txt", "copy-dst.txt"]);
});

test("deleted file", () => {
  const file = one("deleted");
  assert.equal(file.status, "deleted");
  assert.deepEqual([file.oldPath, file.newPath, file.path], ["deleted.txt", null, "deleted.txt"]);
  assert.deepEqual([file.additions, file.deletions], [0, 1]);
  assert.deepEqual([file.hunks[0]!.newStart, file.hunks[0]!.newLines], [0, 0]);
});

test("added empty file has no old side and no hunks", () => {
  const file = one("empty-added");
  assert.equal(file.status, "added");
  assert.deepEqual([file.oldPath, file.newPath], [null, "empty.txt"]);
  assert.deepEqual(file.hunks, []);
});

test("binary file", () => {
  const file = one("binary");
  assert.equal(file.status, "added");
  assert.equal(file.binary, true);
  assert.equal(file.path, "image.png");
  assert.deepEqual(file.hunks, []);
});

test("paths with non-ASCII and spaces, raw (core.quotePath=false)", () => {
  const files = parseUnifiedDiff(fixture("unicode-path-raw"));
  assert.deepEqual(
    files.map((f) => [f.oldPath, f.newPath, f.path]),
    [
      ["café file.txt", "café file.txt", "café file.txt"],
      ["has space.txt", "has space.txt", "has space.txt"],
    ],
  );
  assert.equal(files[0]!.hunks[0]!.lines[0]!.content, "café content");
});

test("paths quoted with octal escapes (core.quotePath=true)", () => {
  const file = one("unicode-path-quoted");
  assert.deepEqual([file.oldPath, file.newPath, file.path], ["café file.txt", "café file.txt", "café file.txt"]);
  assert.equal(file.hunks.length, 1);
});

test("cUnquote handles escapes, octal bytes and plain strings", () => {
  assert.equal(cUnquote('"caf\\303\\251 \\"x\\"\\t\\\\y"'), 'café "x"\t\\y');
  assert.equal(cUnquote("plain.txt"), "plain.txt");
  assert.equal(cUnquote('""'), "");
});

test("a whole staged diff: every file kind at once, in git's order", () => {
  const diff = buildDiff(parseUnifiedDiff(fixture("all")));
  assert.deepEqual(
    diff.files.map((f) => [f.path, f.status]),
    [
      ["café file.txt", "modified"],
      ["copy-dst.txt", "copied"],
      ["deleted.txt", "deleted"],
      ["empty.txt", "added"],
      ["has space.txt", "modified"],
      ["image.png", "added"],
      ["moved-dst.txt", "renamed"],
      ["multi.txt", "modified"],
      ["nonl.txt", "modified"],
      ["renamed-dst.txt", "renamed"],
    ],
  );
  assert.deepEqual([diff.additions, diff.deletions], [6, 6]);
  assert.equal(diff.files.find((f) => f.path === "image.png")!.binary, true);
});

test("text that is not a diff parses to nothing", () => {
  assert.deepEqual(parseUnifiedDiff(""), []);
  assert.deepEqual(parseUnifiedDiff("fatal: bad revision\n"), []);
});
