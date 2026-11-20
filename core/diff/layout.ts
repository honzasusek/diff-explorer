// The pane's row model. Every element the pane draws takes a known number of
// rows, so the pane can draw only the hunks near the scroll window and put a
// Box of the same height where the others would be: the tree's row count
// never changes, the engine's scroll position stays valid, and a scroll to a
// keyed hunk lands even when that hunk is not drawn (research note, findings
// 4 and 5).
//
// Rows, top to bottom: `headRows` fixed rows, then per file its header and,
// unless the file is folded or binary, per hunk its header plus every line.
// The engine draws no `@@` row of its own for a diff Code, so the hunk header
// is the pane's. How many rows each of those takes is the RowMeasure's word:
// one each by default, more where the pane wraps long text (core/diff/wrap.ts).
//
// For a Diff of two files, A with hunks of 3 and 5 lines and B binary, with
// two head rows and one row each: A's header at row 2, its hunks at rows 3
// (4 rows) and 7 (6 rows), B's header at row 13, 14 rows in all.
import type { Diff, DiffFile, Hunk } from "../types.ts";

export interface HunkSlot {
  key: string;
  file: DiffFile;
  hunk: Hunk;
  index: number;
  /** The first row, 0 at the top of the tree. */
  top: number;
  rows: number;
  /** Rows of the hunk's header. */
  headerRows: number;
  /** Rows of each line, in order: the gutter button beside a line is this tall. */
  lineRows: number[];
}

export interface FileSlot {
  key: string;
  file: DiffFile;
  top: number;
  /** The header and every hunk under it. */
  rows: number;
  headerRows: number;
  hunks: HunkSlot[];
}

/** Rows each part of the tree takes; every answer is at least 1. */
export interface RowMeasure {
  fileHeader(file: DiffFile, folded: boolean): number;
  hunkHeader(file: DiffFile, hunk: Hunk): number;
  line(hunk: Hunk, index: number): number;
}

/** Every part on one row: text cut at the edge, nothing wrapped. */
export const ONE_ROW: RowMeasure = { fileHeader: () => 1, hunkHeader: () => 1, line: () => 1 };

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

export function layoutDiff(diff: Diff, folded: ReadonlySet<string>, headRows: number, measure: RowMeasure = ONE_ROW): Layout {
  let top = headRows;
  const files = diff.files.map((file): FileSlot => {
    const fileTop = top;
    const isFolded = folded.has(file.id);
    const fileHeaderRows = Math.max(1, measure.fileHeader(file, isFolded));
    top += fileHeaderRows;
    const hunks: HunkSlot[] = [];
    if (!isFolded) {
      file.hunks.forEach((hunk, index) => {
        const headerRows = Math.max(1, measure.hunkHeader(file, hunk));
        const lineRows = hunk.lines.map((_, i) => Math.max(1, measure.line(hunk, i)));
        const rows = headerRows + lineRows.reduce((sum, n) => sum + n, 0);
        hunks.push({ key: hunkKey(file.id, index), file, hunk, index, top, rows, headerRows, lineRows });
        top += rows;
      });
    }
    return { key: fileKey(file.id), file, top: fileTop, rows: top - fileTop, headerRows: fileHeaderRows, hunks };
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
