// Cutting a hunk to the rows a scroll window shows. The terminal pane draws
// only its window (hooks/pane.tsx), so a hunk the window's top or bottom
// cuts through is drawn from its first shown line to its last, as a hunk of
// its own.
//
// Sample: a hunk whose body lines take `[1, 3, 1, 1]` rows (the second wraps
// to three). A window over its body rows 2 to 4 shows lines 1 and 2, with
// line 1's first two rows above the window's top.
import type { Hunk } from "../types.ts";

/** Where a window over body rows `from` to `to` cuts a list of pieces (a
 * hunk's lines, or its blocks side by side), each piece its rows: the first
 * piece it shows, the rows of that piece above the window's top, and the
 * piece after the last it shows. The sample gives `cut([1, 3, 1, 1], 2, 5)`
 * `{ first: 1, above: 1, end: 3 }`. A window past the end shows nothing:
 * `first` and `end` are the pieces' count. */
export function cut(rows: readonly number[], from: number, to: number): { first: number; above: number; end: number } {
  let top = 0;
  for (let first = 0; first < rows.length; first++) {
    const n = rows[first] ?? 1;
    if (top + n > from) {
      let end = first + 1;
      let below = top + n;
      while (end < rows.length && below < to) {
        below += rows[end] ?? 1;
        end++;
      }
      return { first, above: Math.max(0, from - top), end };
    }
    top += n;
  }
  return { first: rows.length, above: 0, end: rows.length };
}

/** The lines `from` to `end` of a hunk as a hunk of their own, its header
 * counting them, so the engine numbers them as in the whole hunk: lines 1
 * to 3 of `@@ -1,3 +1,4 @@` (context, deleted, added) give `@@ -2,2 +2,2 @@`.
 * A side with no line in the slice starts where git puts it: at the last
 * line before the slice, or where the hunk starts. */
export function subHunk(hunk: Hunk, from: number, end: number): Hunk {
  const lines = hunk.lines.slice(from, end);
  const before = hunk.lines.slice(0, from).reverse();
  const start = (side: "oldNo" | "newNo", whole: number) =>
    lines.find((line) => line[side] !== null)?.[side] ?? before.find((line) => line[side] !== null)?.[side] ?? whole;
  return {
    ...hunk,
    oldStart: start("oldNo", hunk.oldStart),
    oldLines: lines.filter((line) => line.type !== "add").length,
    newStart: start("newNo", hunk.newStart),
    newLines: lines.filter((line) => line.type !== "del").length,
    lines,
  };
}
