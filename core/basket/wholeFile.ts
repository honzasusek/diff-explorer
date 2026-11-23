// Whether a whole-file ref still matches the Diff. Such a ref holds every
// line of the file, the Diff only three lines around each change, so the
// ref is not a run of the Diff's lines; instead the two must agree where
// they overlap.
//
// A ref of `a`, `-b`, `+B`, `c`, `d` against a Diff showing `-b`, `+B`, `c`
// is fresh. Once Claude edits `d`, the Diff gains `-d`, `+D`: a changed line
// the ref lacks, so it is stale. Once Claude undoes `B`, the ref holds a
// changed line the Diff lacks: stale too.
import type { CodeRef, Diff, DiffLine } from "../types.ts";

function sameLine(a: DiffLine, b: DiffLine): boolean {
  return a.type === b.type && a.content === b.content && a.oldNo === b.oldNo && a.newNo === b.newNo;
}

/** Fresh when the changed lines match one for one, in order, and every line
 * the Diff shows of the file, numbers included, stands in the ref in order. */
export function isWholeFileFresh(ref: CodeRef, diff: Diff): boolean {
  const file = diff.files.find((f) => f.path === ref.file);
  if (file === undefined) return false;
  const shown = file.hunks.flatMap((h) => h.lines);
  const changedShown = shown.filter((l) => l.type !== "context");
  const changedRef = ref.lines.filter((l) => l.type !== "context");
  if (changedShown.length !== changedRef.length) return false;
  if (!changedShown.every((line, i) => sameLine(line, changedRef[i]!))) return false;
  let at = 0;
  for (const line of shown) {
    while (at < ref.lines.length && !sameLine(ref.lines[at]!, line)) at++;
    if (at === ref.lines.length) return false;
    at++;
  }
  return true;
}
