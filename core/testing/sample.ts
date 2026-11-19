// A small Diff the selection, refs, basket and locate specs share. Four
// files: client.ts with two hunks, retry.ts added, README.md whose hunk
// repeats a line of client.ts so a selection can be ambiguous, and LICENSE
// deleted. client.ts's first hunk, by row:
//   row 0   40 40    const res = await fetch(url, opts);
//   row 1   41    -  if (!res.ok) throw new Error(res.status);
//   row 2      41 +  if (!res.ok && retryable(res)) {
//   row 3      42 +    return retry(() => charge(url, opts));
//   row 4   42 43    return res.json();
import { buildDiff, parseUnifiedDiff } from "../diff/parser.ts";
import type { Diff, DiffFile } from "../types.ts";

export const CLIENT = "src/payments/client.ts";

export const SAMPLE_PATCH = [
  "diff --git a/src/payments/client.ts b/src/payments/client.ts",
  "index 1111111..2222222 100644",
  "--- a/src/payments/client.ts",
  "+++ b/src/payments/client.ts",
  "@@ -40,3 +40,4 @@ export async function charge(",
  "   const res = await fetch(url, opts);",
  "-  if (!res.ok) throw new Error(res.status);",
  "+  if (!res.ok && retryable(res)) {",
  "+    return retry(() => charge(url, opts));",
  "   return res.json();",
  "@@ -80,2 +81,3 @@ export function retryable(",
  "   return res.status >= 500;",
  "+  // 429 is retryable too",
  " }",
  "diff --git a/src/payments/retry.ts b/src/payments/retry.ts",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/src/payments/retry.ts",
  "@@ -0,0 +1,3 @@",
  "+export function retry<T>(fn: () => Promise<T>): Promise<T> {",
  "+  return fn();",
  "+}",
  "diff --git a/README.md b/README.md",
  "index 4444444..5555555 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,2 +1,1 @@",
  "-Old title",
  "-  return res.json();",
  "+New title",
  "diff --git a/LICENSE b/LICENSE",
  "deleted file mode 100644",
  "index 6666666..0000000",
  "--- a/LICENSE",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  "-MIT",
  "-Copyright",
  "",
].join("\n");

export function sampleDiff(): Diff {
  return buildDiff(parseUnifiedDiff(SAMPLE_PATCH));
}

/** The sample's file at `path`; throws on a path the sample lacks. */
export function sampleFile(diff: Diff, path: string): DiffFile {
  const file = diff.files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`no sample file ${path}`);
  return file;
}
