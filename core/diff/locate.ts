// Mapping a terminal selection back to rows of the Diff. The engine hands a
// drag's text as the lines' content joined with newlines, no gutter and no
// markers (research note, finding 3), so the match is by content: a run of
// rows of one hunk whose middle rows equal the selected ones, the first line
// ending with the first row and the last line starting with the last row,
// since a drag begins and ends mid-line.
//
// Sample: "retryable(res)) {" through "    return retry(() => charge" in
// client.ts lands on rows 2 to 3 of its first hunk.
import type { Diff, DiffFile } from "../types.ts";

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
    const row = rows[i] ?? "";
    const line = content.trimEnd();
    if (n === 1) return line.includes(row);
    if (i === 0) return line.endsWith(row);
    if (i === n - 1) return line.startsWith(row);
    return line === row;
  };
  const candidates: LocatedRows[] = [];
  for (const file of diff.files) {
    file.hunks.forEach((hunk, hunkIndex) => {
      for (let at = 0; at + n <= hunk.lines.length; at++) {
        let ok = true;
        for (let i = 0; i < n && ok; i++) ok = matches(hunk.lines[at + i]?.content ?? "", i);
        if (ok) candidates.push({ file, hunk: hunkIndex, from: at, to: at + n - 1 });
      }
    });
  }
  const hinted = hint === undefined ? [] : candidates.filter((c) => c.file.path === hint.file);
  const picked = hinted.length === 1 ? hinted : candidates;
  const [first] = picked;
  if (first === undefined) return { kind: "notFound" };
  if (picked.length === 1) return { kind: "located", at: first };
  return { kind: "ambiguous", candidates: picked };
}
