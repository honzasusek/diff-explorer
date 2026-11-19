// The pane's row model. Every element the pane draws takes a known number of
// rows, so the pane can draw only the hunks near the scroll window and put a
// Box of the same height where the others would be: the tree's row count
// never changes, the engine's scroll position stays valid, and a scroll to a
// keyed hunk lands even when that hunk is not drawn (research note, findings
// 4 and 5).
//
// Rows, top to bottom: `headRows` fixed rows, then per file a header row and,
// unless the file is folded or binary, per hunk a header row plus one row per
// line. The engine draws no `@@` row of its own for a diff Code, so the hunk
// header row is the pane's.
//
// For a Diff of two files, A with hunks of 3 and 5 lines and B binary, with
// two head rows: A's header at row 2, its hunks at rows 3 (4 rows) and 7
// (6 rows), B's header at row 13, 14 rows in all.
import type { Diff, DiffFile, Hunk } from "../types.ts";

export interface HunkSlot {
  key: string;
  file: DiffFile;
  hunk: Hunk;
  index: number;
  /** The first row, 0 at the top of the tree. */
  top: number;
  rows: number;
}

export interface FileSlot {
  key: string;
  file: DiffFile;
  top: number;
  /** The header row and every hunk under it. */
  rows: number;
  hunks: HunkSlot[];
}

export interface Layout {
  files: FileSlot[];
  /** Rows of the whole tree. */
  rows: number;
}

export interface Window {
  offset: number;
  bodyRows: number;
}

export function fileKey(id: string): string {
  return `file:${id}`;
}

export function hunkKey(id: string, index: number): string {
  return `hunk:${id}:${index}`;
}

/** Rows a drawn hunk takes: the pane's header row and one row per line. */
export function hunkRows(hunk: Hunk): number {
  return 1 + hunk.lines.length;
}

export function layoutDiff(diff: Diff, folded: ReadonlySet<string>, headRows: number): Layout {
  let top = headRows;
  const files = diff.files.map((file): FileSlot => {
    const fileTop = top;
    top += 1;
    const hunks: HunkSlot[] = [];
    if (!folded.has(file.id)) {
      file.hunks.forEach((hunk, index) => {
        const rows = hunkRows(hunk);
        hunks.push({ key: hunkKey(file.id, index), file, hunk, index, top, rows });
        top += rows;
      });
    }
    return { key: fileKey(file.id), file, top: fileTop, rows: top - fileTop, hunks };
  });
  return { files, rows: top };
}

/** The hunks worth drawing for a window: those with a row inside
 * `offset - before * bodyRows` to `offset + after * bodyRows`, in document
 * order. Two windows above and three below keep a wheel scroll in either
 * direction inside drawn rows while the next drawing is on its way. */
export function hunksNear(layout: Layout, window: Window, before = 2, after = 3): HunkSlot[] {
  const lo = window.offset - before * window.bodyRows;
  const hi = window.offset + after * window.bodyRows;
  const near: HunkSlot[] = [];
  for (const file of layout.files) {
    for (const hunk of file.hunks) {
      if (hunk.top < hi && hunk.top + hunk.rows > lo) near.push(hunk);
    }
  }
  return near;
}
