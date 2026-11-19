// The Basket: the Code Refs waiting for the next Prompt. A ref is known by
// its id (file, Side and range), so adding the same lines twice keeps the
// first; a Stale Ref is one whose captured lines the Diff no longer holds
// (ADR-0003), which the band marks rather than re-pointing it.
import type { CodeRef, Diff, DiffLine } from "../types.ts";

export type Basket = readonly CodeRef[];

export type BasketAction = { type: "add"; ref: CodeRef } | { type: "remove"; id: string } | { type: "clear" };

export function basketReducer(basket: Basket, action: BasketAction): Basket {
  switch (action.type) {
    case "add":
      return basket.some((r) => r.id === action.ref.id) ? basket : [...basket, action.ref];
    case "remove":
      return basket.filter((r) => r.id !== action.id);
    case "clear":
      return [];
  }
}

function sameLine(a: DiffLine, b: DiffLine): boolean {
  return a.type === b.type && a.content === b.content && a.oldNo === b.oldNo && a.newNo === b.newNo;
}

/** Whether the ref's lines still stand in the Diff as captured, numbers
 * included: a line Claude edited, or one inserted above, makes it stale. The
 * search runs over the file's hunks laid end to end, so a ref that spans two
 * hunks is found too. */
export function isFresh(ref: CodeRef, diff: Diff): boolean {
  const file = diff.files.find((f) => f.path === ref.file);
  if (file === undefined) return false;
  const lines = file.hunks.flatMap((h) => h.lines);
  for (let at = 0; at + ref.lines.length <= lines.length; at++) {
    if (ref.lines.every((line, i) => sameLine(line, lines[at + i]!))) return true;
  }
  return false;
}

/** The ids of the Stale Refs in the Basket. */
export function markStale(basket: Basket, diff: Diff): string[] {
  return basket.filter((ref) => !isFresh(ref, diff)).map((ref) => ref.id);
}
