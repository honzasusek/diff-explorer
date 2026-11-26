// The pane's row model. Every element the pane draws takes a known number of
// rows, so the terminal pane, which scrolls its diff itself, knows which rows
// its window shows, draws only those (core/diff/window.ts cuts a hunk to
// them), and can bring a chip's hunk to the window's top.
//
// Rows, top to bottom: `headRows` fixed rows, then per file its header and,
// unless the file is folded or binary, per hunk its header plus its body.
// The engine draws no `@@` row of its own for a diff Code, so the hunk header
// is the pane's. The body is drawn in pieces: one per line in the unified
// view, one per block in the side-by-side view (core/diff/split.ts). How many
// rows each of those takes is the RowMeasure's word: one per line by default,
// more where the pane wraps long text (core/diff/wrap.ts).
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
  /** Rows of each piece of the body, in order: a line, or a block of the
   * side-by-side view. The gutter button beside a line is as tall as its piece. */
  bodyRows: number[];
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
  /** Rows of each piece of the hunk's body, as the pane draws it. */
  body(hunk: Hunk): number[];
}

/** Every part on one row: text cut at the edge, nothing wrapped. */
export const ONE_ROW: RowMeasure = { fileHeader: () => 1, hunkHeader: () => 1, body: (hunk) => hunk.lines.map(() => 1) };

export interface Layout {
  files: FileSlot[];
  /** Rows of the whole tree. */
  rows: number;
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
        const bodyRows = measure.body(hunk).map((n) => Math.max(1, n));
        const rows = headerRows + bodyRows.reduce((sum, n) => sum + n, 0);
        hunks.push({ key: hunkKey(file.id, index), file, hunk, index, top, rows, headerRows, bodyRows });
        top += rows;
      });
    }
    return { key: fileKey(file.id), file, top: fileTop, rows: top - fileTop, headerRows: fileHeaderRows, hunks };
  });
  return { files, rows: top };
}
