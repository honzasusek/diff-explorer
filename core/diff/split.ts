// The side-by-side view of a hunk: the old file on the left, the new on the
// right, each change beside what it replaced. A hunk is cut into blocks. A
// context block holds unchanged lines, drawn on both sides. A change block
// holds a run of deleted lines, drawn on the left, and the added lines after
// them, drawn on the right; the shorter side is padded with blank rows, so
// the next block starts level on both sides.
//
// Sample hunk, by line index: 0 ` a`, 1 `-b`, 2 `-c`, 3 `+B`, 4 ` d`, 5 `+e`.
// It gives four blocks: context [0] beside [0], change [1, 2] beside [3],
// context [4] beside [4], then change [] beside [5].
import type { DiffLine, Hunk, Side } from "../types.ts";

export interface SplitBlock {
  kind: "context" | "change";
  /** Indexes into the hunk's lines drawn on the left: context or deleted lines. */
  left: number[];
  /** Indexes drawn on the right: context or added lines. */
  right: number[];
}

/** The hunk's blocks, top to bottom; see the sample above. */
export function splitHunk(hunk: Hunk): SplitBlock[] {
  const blocks: SplitBlock[] = [];
  hunk.lines.forEach((line, index) => {
    const last = blocks[blocks.length - 1];
    if (line.type === "context") {
      if (last?.kind === "context") {
        last.left.push(index);
        last.right.push(index);
      } else {
        blocks.push({ kind: "context", left: [index], right: [index] });
      }
    } else if (line.type === "del") {
      // A deletion after additions starts a new change: `-a +b -c +d` pairs
      // a with b and c with d, as it reads.
      if (last?.kind === "change" && last.right.length === 0) last.left.push(index);
      else blocks.push({ kind: "change", left: [index], right: [] });
    } else if (last?.kind === "change") {
      last.right.push(index);
    } else {
      blocks.push({ kind: "change", left: [], right: [index] });
    }
  });
  return blocks;
}

/** The line number a side shows: the old one on the left, the new one on the right. */
export function sideNumber(line: DiffLine, side: Side): number | null {
  return side === "old" ? line.oldNo : line.newNo;
}

/** One side of a block as a diff hunk of its own, for the engine's diff
 * Code, which numbers and colours it. Both ranges of the header start at the
 * side's own first number, so every row shows that side's numbers: the left
 * side of context lines 7 and 8 (new 9 and 10) is `@@ -7,2 +7,2 @@`,
 * ` x`, ` y`. Empty when the side has no lines. */
export function sideSource(hunk: Hunk, indexes: readonly number[], side: Side): string {
  const lines = indexes.flatMap((i) => hunk.lines[i] ?? []);
  const [first] = lines;
  if (first === undefined) return "";
  const start = sideNumber(first, side) ?? 0;
  const n = lines.length;
  const range =
    first.type === "context" ? `-${start},${n} +${start},${n}` : first.type === "del" ? `-${start},${n} +${start},0` : `-${start},0 +${start},${n}`;
  const marker = first.type === "context" ? " " : first.type === "del" ? "-" : "+";
  return [`@@ ${range} @@`, ...lines.map((line) => marker + line.content)].join("\n");
}

/** Digits of the widest number a side shows for these lines, at least 1. */
export function sideDigits(hunk: Hunk, indexes: readonly number[], side: Side): number {
  let digits = 1;
  for (const i of indexes) {
    const line = hunk.lines[i];
    if (line !== undefined) digits = Math.max(digits, String(sideNumber(line, side) ?? "").length);
  }
  return digits;
}
