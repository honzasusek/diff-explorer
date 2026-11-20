// How many terminal rows a piece of text takes once wrapped, so the pane can
// keep its exact row count (core/diff/layout.ts) while long lines wrap
// instead of being cut. Two rules, measured in a session (research note,
// "Wrapping in the pane"):
//
// - A diff Code wraps by character. Each row starts with a prefix of
//   `digits + 3` cells (a space, the line number padded to the hunk's widest,
//   a space, the marker), and the code fills the rest. A line that fits
//   exactly stays on one row. A wide character that does not fit moves whole
//   to the next row.
// - Tabs: each tab of the line's leading run draws two cells; a later tab
//   moves to the next multiple of eight.
//
// Headers are not left to the engine's word wrap: `wrapWords` breaks them
// here and the pane draws one Text per row, so their count is exact too.
//
// With 10 cells of room, `codeRows("abcdefghijKL", 10)` is 2 and
// `wrapWords("M src/a.ts +2 -1", 10)` is `["M src/a.ts", "+2 -1"]`.

/** Cells a code point takes: 2 for East Asian wide and fullwidth characters
 * and emoji, 0 for combining marks and controls, else 1. */
export function cellWidth(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x1fa70 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Cells a string takes on one row, tabs counted as one. */
export function textWidth(text: string): number {
  let cells = 0;
  for (const ch of text) cells += cellWidth(ch.codePointAt(0) ?? 0);
  return cells;
}

/** Rows a line of code takes in `width` cells, as a diff Code wraps it; at least 1. */
export function codeRows(content: string, width: number): number {
  const room = Math.max(1, width);
  // Most lines are plain and short: no tab, and fewer characters than half
  // the room, so no mix of wide ones can fill it.
  if (content.length * 2 <= room && !content.includes("\t")) return 1;
  let rows = 1;
  let col = 0; // cells used on the current row
  let at = 0; // cells since the line's start, for tab stops
  let leading = true;
  for (const ch of content) {
    let w: number;
    if (ch === "\t") {
      w = leading ? 2 : 8 - (at % 8);
    } else {
      leading = false;
      w = cellWidth(ch.codePointAt(0) ?? 0);
    }
    at += w;
    if (ch === "\t") {
      // Blank cells run on across a row's end.
      col += w;
      while (col > room) {
        rows++;
        col -= room;
      }
      continue;
    }
    if (col + w > room && col > 0) {
      rows++;
      col = 0;
    }
    col += w;
  }
  return rows;
}

/** Breaks text into rows of at most `width` cells: at spaces where it can, a
 * word longer than a row cut where it must. */
export function wrapWords(text: string, width: number): string[] {
  const room = Math.max(1, width);
  if (textWidth(text) <= room) return [text];
  const rows: string[] = [];
  let row = "";
  let used = 0;
  const push = () => {
    rows.push(row.trimEnd());
    row = "";
    used = 0;
  };
  for (const word of text.split(/(?<= )/)) {
    const w = textWidth(word.trimEnd());
    if (used > 0 && used + w > room) push();
    if (w > room) {
      for (const ch of word) {
        const c = cellWidth(ch.codePointAt(0) ?? 0);
        if (used + c > room && used > 0) push();
        if (used === 0 && ch === " ") continue;
        row += ch;
        used += c;
      }
      continue;
    }
    if (used === 0 && word.trim() === "") continue;
    row += word;
    used += textWidth(word);
  }
  if (row.trim() !== "") push();
  return rows.length === 0 ? [""] : rows;
}
