// Picking lines of the Diff and turning the pick into a Code Ref. A Code Ref
// is a run of rows of one hunk, or the rows a range of line numbers covers,
// captured with the lines themselves (ADR-0003). Its Side is the new one when
// any row has a new number, else the old one; `start` and `end` are the first
// and last numbers on that Side.
//
// Sample for the examples: `client.ts`, hunk 0 is `@@ -40,3 +40,4 @@`:
//   row 0   40 40    const res = await fetch(url, opts);
//   row 1   41    -  if (!res.ok) throw new Error(res.status);
//   row 2      41 +  if (!res.ok && retryable(res)) {
//   row 3      42 +    return retry(() => charge(url, opts));
//   row 4   42 43    return res.json();
import type { CodeRef, Diff, DiffFile, DiffLine, HunkRow, LineRange, Side } from "../types.ts";

/** Where the gutter gesture stands: the row of the first press, or nothing. */
export type Anchor = HunkRow | null;

/** What a gutter press does: sets the anchor, clears it, or completes a range. */
export type GutterPress =
  | { kind: "anchor"; anchor: HunkRow }
  | { kind: "clear" }
  | { kind: "range"; file: string; hunk: number; from: number; to: number };

/** The two-press gesture. A first press anchors; a second press in the same
 * hunk completes the range in either order (anchor row 3, then row 1, gives
 * rows 1 to 3); pressing the anchor again clears; a press in another hunk or
 * file starts over there. Presses carry no modifiers, so there is no
 * shift-click to extend with. */
export function gutterPress(anchor: Anchor, row: HunkRow): GutterPress {
  if (anchor === null || anchor.file !== row.file || anchor.hunk !== row.hunk) {
    return { kind: "anchor", anchor: row };
  }
  if (anchor.row === row.row) return { kind: "clear" };
  return {
    kind: "range",
    file: row.file,
    hunk: row.hunk,
    from: Math.min(anchor.row, row.row),
    to: Math.max(anchor.row, row.row),
  };
}

export function refId(file: string, side: Side, start: number, end: number): string {
  return `${file}:${side}:${start}-${end}`;
}

function lineNo(line: DiffLine, side: Side): number | null {
  return side === "new" ? line.newNo : line.oldNo;
}

/** The ref for a run of lines on a Side (the new one when any line has a
 * new number, unless told otherwise); undefined for a run without a number
 * on that Side. */
function refFor(file: string, lines: DiffLine[], side?: Side): CodeRef | undefined {
  const on: Side = side ?? (lines.some((l) => l.newNo !== null) ? "new" : "old");
  const numbers = lines.map((l) => lineNo(l, on)).filter((n): n is number => n !== null);
  if (numbers.length === 0) return undefined;
  const start = Math.min(...numbers);
  const end = Math.max(...numbers);
  return { id: refId(file, on, start, end), file, side: on, start, end, lines };
}

/** Rows `from` to `to` of one hunk, as drawn: rows 1 to 3 of the sample give
 * a new-Side ref 41-42 holding the deleted line and the two added ones. */
export function captureRows(file: DiffFile, hunkIndex: number, from: number, to: number): CodeRef | undefined {
  const hunk = file.hunks[hunkIndex];
  return hunk === undefined ? undefined : refFor(file.path, hunk.lines.slice(from, to + 1));
}

/** The lines a range of numbers covers: in each hunk, from the first line
 * numbered inside the range on that Side to the last, so a deleted line
 * between two kept ones comes along and one before the first does not.
 * `new 41-43` on the sample gives rows 2 to 4; `old 41-42` gives rows 1 to 4. */
export function captureRef(diff: Diff, range: LineRange): CodeRef | undefined {
  const file = diff.files.find((f) => f.path === range.file);
  if (file === undefined) return undefined;
  const lines: DiffLine[] = [];
  for (const hunk of file.hunks) {
    let first = -1;
    let last = -1;
    hunk.lines.forEach((line, i) => {
      const n = lineNo(line, range.side);
      if (n === null || n < range.from || n > range.to) return;
      if (first === -1) first = i;
      last = i;
    });
    if (first !== -1) lines.push(...hunk.lines.slice(first, last + 1));
  }
  return refFor(file.path, lines, range.side);
}

export function captureHunk(file: DiffFile, hunkIndex: number): CodeRef | undefined {
  const hunk = file.hunks[hunkIndex];
  return hunk === undefined ? undefined : refFor(file.path, hunk.lines);
}

/** Every changed hunk of the file, not the file whole (ADR-0003); a binary
 * or empty file has none. */
export function captureFile(file: DiffFile): CodeRef | undefined {
  return refFor(
    file.path,
    file.hunks.flatMap((h) => h.lines),
  );
}
