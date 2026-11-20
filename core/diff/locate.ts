// Mapping a terminal selection back to rows of the Diff. The engine hands a
// drag's text as the lines' content joined with newlines, no gutter and no
// markers (research note, finding 3), so the match is by content: a run of
// rows of one hunk whose middle rows equal the selected ones, the first line
// ending with the first row and the last line starting with the last row,
// since a drag begins and ends mid-line.
//
// A line wider than the pane is cut with `…` (the Code's `truncate-end`), and
// the selection carries the cut row as shown: the text up to the cut and the
// `…`, nothing after. Such a row matches as a prefix of its line.
//
// A line the Code wraps comes back as one row per screen row, split wherever
// the wrap fell (research note, "Wrapping in the pane"). When no run of whole
// rows matches, the selection is matched again with its row breaks and every
// blank dropped, against each hunk's lines joined the same way: the rows
// "the CommonJS build i" and "s removed." find the line that holds
// "the CommonJS build is removed.".
//
// Sample: "retryable(res)) {" through "    return retry(() => charge" in
// client.ts lands on rows 2 to 3 of its first hunk, and so does
// "retryable(res)…" through "    return retry(() => charge".
import type { Diff, DiffFile } from "../types.ts";

/** What the pane draws at the end of a row it cut. */
const CUT = "…";

export interface LocatedRows {
  file: DiffFile;
  hunk: number;
  from: number;
  to: number;
}

export type Located =
  | { kind: "located"; at: LocatedRows }
  | { kind: "ambiguous"; candidates: LocatedRows[] }
  | { kind: "notFound" };

/** Where the selected text sits. Trailing blanks and spaces are ignored,
 * since a copy pads rows to the pane. Several places give `ambiguous`,
 * unless the hinted file holds exactly one of them. */
export function locateText(diff: Diff, text: string, hint?: { file: string }): Located {
  const rows = text.split("\n").map((r) => r.trimEnd());
  while (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();
  while (rows.length > 0 && rows[0] === "") rows.shift();
  if (rows.length === 0 || (rows.length === 1 && rows[0]?.trim() === "")) return { kind: "notFound" };
  const n = rows.length;
  const matches = (content: string, i: number): boolean => {
    const shown = rows[i] ?? "";
    const cut = shown.endsWith(CUT);
    const row = cut ? shown.slice(0, -CUT.length) : shown;
    const line = content.trimEnd();
    if (n === 1 || (i === 0 && cut)) return line.includes(row);
    if (i === 0) return line.endsWith(row);
    if (i === n - 1 || cut) return line.startsWith(row);
    return line === row;
  };
  let candidates: LocatedRows[] = [];
  for (const file of diff.files) {
    file.hunks.forEach((hunk, hunkIndex) => {
      for (let at = 0; at + n <= hunk.lines.length; at++) {
        let ok = true;
        for (let i = 0; i < n && ok; i++) ok = matches(hunk.lines[at + i]?.content ?? "", i);
        if (ok) candidates.push({ file, hunk: hunkIndex, from: at, to: at + n - 1 });
      }
    });
  }
  if (candidates.length === 0 && n > 1) candidates = locateJoined(diff, rows.join(""));
  const hinted = hint === undefined ? [] : candidates.filter((c) => c.file.path === hint.file);
  const picked = hinted.length === 1 ? hinted : candidates;
  const [first] = picked;
  if (first === undefined) return { kind: "notFound" };
  if (picked.length === 1) return { kind: "located", at: first };
  return { kind: "ambiguous", candidates: picked };
}

const BLANK = /\s/;

/** The places a selection sits once row breaks and blanks no longer count:
 * each hunk's lines are joined without their blanks, each kept character
 * remembering its line, and every occurrence of the selection's characters
 * gives the lines it runs from and to. */
function locateJoined(diff: Diff, text: string): LocatedRows[] {
  const needle = text.replace(/\s+/g, "");
  if (needle === "") return [];
  const found: LocatedRows[] = [];
  for (const file of diff.files) {
    file.hunks.forEach((hunk, hunkIndex) => {
      const chars: string[] = [];
      const lineOf: number[] = [];
      hunk.lines.forEach((line, index) => {
        for (const ch of line.content) {
          if (BLANK.test(ch)) continue;
          chars.push(ch);
          // One entry per UTF-16 unit, the unit indexOf counts in.
          for (let unit = 0; unit < ch.length; unit++) lineOf.push(index);
        }
      });
      const joined = chars.join("");
      const seen = new Set<string>();
      for (let at = joined.indexOf(needle); at !== -1; at = joined.indexOf(needle, at + 1)) {
        const from = lineOf[at] ?? 0;
        const to = lineOf[at + needle.length - 1] ?? from;
        if (seen.has(`${from}:${to}`)) continue;
        seen.add(`${from}:${to}`);
        found.push({ file, hunk: hunkIndex, from, to });
      }
    });
  }
  return found;
}
