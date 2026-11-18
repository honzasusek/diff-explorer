import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiff, parseUnifiedDiff } from "./parser.ts";

const SAMPLE = [
  "diff --git a/src/client.ts b/src/client.ts",
  "index 1111111..2222222 100644",
  "--- a/src/client.ts",
  "+++ b/src/client.ts",
  "@@ -40,3 +40,4 @@ export async function charge(",
  "   const res = await fetch(url, opts);",
  "-  if (!res.ok) throw new Error(res.status);",
  "+  if (!res.ok && retryable(res)) {",
  "+    return retry(() => charge(url, opts));",
  "   return res.json();",
  "",
].join("\n");

test("parses one modified file with one hunk", () => {
  const diff = buildDiff(parseUnifiedDiff(SAMPLE));
  assert.equal(diff.files.length, 1);
  const file = diff.files[0]!;
  assert.equal(file.path, "src/client.ts");
  assert.equal(file.status, "modified");
  assert.deepEqual([diff.additions, diff.deletions], [2, 1]);
  const hunk = file.hunks[0]!;
  assert.equal(hunk.header, "export async function charge(");
  assert.deepEqual(
    hunk.lines.map((l) => [l.type, l.oldNo, l.newNo]),
    [
      ["context", 40, 40],
      ["del", 41, null],
      ["add", null, 41],
      ["add", null, 42],
      ["context", 42, 43],
    ],
  );
});
