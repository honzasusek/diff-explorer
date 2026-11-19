// Code Refs as text: the `code_ref` blocks a Prompt carries, the chip label,
// the typed `#path:from-to` token and its typeahead, and where a ref sits
// in the Diff now.
//
// Sample for the examples: the ref `new 41-42` of `src/payments/client.ts`,
// rows 1 to 3 of its first hunk (one deleted line, two added).
import type { CodeRef, Diff, DiffFile, Side } from "../types.ts";
import { captureFile, captureRef } from "./selection.ts";

const MARKERS: Record<CodeRef["lines"][number]["type"], string> = { context: " ", add: "+", del: "-" };

/** `client.ts:41-42`; `client.ts:41` for one line; `(old)` after an old-Side ref. */
export function refLabel(ref: CodeRef): string {
  const name = ref.file.slice(ref.file.lastIndexOf("/") + 1);
  const lines = ref.start === ref.end ? `${ref.start}` : `${ref.start}-${ref.end}`;
  return `${name}:${lines}${ref.side === "old" ? " (old)" : ""}`;
}

/** One ref as the model reads it. Each line: its number on the ref's Side,
 * blank for a line of the other Side, then the marker, a bar and the text.
 * The sample ref as `r1`:
 *
 *   <code_ref id="r1" file="src/payments/client.ts" side="new" lines="41-42">
 *      -|   if (!res.ok) throw new Error(res.status);
 *   41 +|   if (!res.ok && retryable(res)) {
 *   42 +|     return retry(() => charge(url, opts));
 *   </code_ref>
 */
export function renderRef(ref: CodeRef, id: string): string {
  const width = String(ref.end).length;
  const rows = ref.lines.map((line) => {
    const n = ref.side === "new" ? line.newNo : line.oldNo;
    return `${(n === null ? "" : String(n)).padStart(width)} ${MARKERS[line.type]}| ${line.content}`;
  });
  const open = `<code_ref id="${id}" file="${ref.file}" side="${ref.side}" lines="${ref.start}-${ref.end}">`;
  return [open, ...rows, "</code_ref>"].join("\n");
}

/** The whole Basket as `r1`, `r2`, ... in order, a blank line between blocks. */
export function renderRefs(refs: readonly CodeRef[]): string {
  return refs.map((ref, i) => renderRef(ref, `r${i + 1}`)).join("\n\n");
}

/** The files a typed name picks: the exact path; else the paths ending in
 * `/name`; else the paths containing it, case-insensitive. `client.ts` picks
 * src/payments/client.ts alone, `payments` picks both files under it. */
export function matchFiles(diff: Diff, name: string): DiffFile[] {
  const exact = diff.files.filter((f) => f.path === name);
  if (exact.length > 0) return exact;
  const bySuffix = diff.files.filter((f) => f.path.endsWith(`/${name}`));
  if (bySuffix.length > 0) return bySuffix;
  const needle = name.toLowerCase();
  return diff.files.filter((f) => f.path.toLowerCase().includes(needle));
}

export type ParsedRef = { ref: CodeRef; error?: undefined } | { ref?: undefined; error: string };

const TOKEN_RE = /^#?([^#:\s][^:\s]*)(?::(\d+)(?:-(\d+))?)?$/;

/** `#path`, `#path:41` or `#path:41-43`, the `#` optional, on the new Side
 * unless told otherwise. A bare path is the file's changed hunks. The error
 * says what went wrong in the person's terms. */
export function parseRefToken(token: string, diff: Diff, side: Side = "new"): ParsedRef {
  const m = TOKEN_RE.exec(token.trim());
  if (m === null) return { error: `Not a ref: ${token.trim() || "(nothing)"}. Write path, path:line or path:from-to.` };
  const [, name = "", fromText, toText] = m;
  const files = matchFiles(diff, name);
  const [file] = files;
  if (file === undefined) return { error: `No file in the diff matches ${name}` };
  if (files.length > 1) return { error: `${name} matches several files: ${files.map((f) => f.path).join(", ")}` };
  if (fromText === undefined) {
    const ref = captureFile(file);
    return ref === undefined ? { error: `${file.path} has no lines to quote` } : { ref };
  }
  const a = Number(fromText);
  const b = toText === undefined ? a : Number(toText);
  const [from, to] = a <= b ? [a, b] : [b, a];
  const ref = captureRef(diff, { file: file.path, side, from, to });
  const range = from === to ? `line ${from}` : `lines ${from}-${to}`;
  return ref === undefined ? { error: `${file.path} has no ${side} ${range} in the diff` } : { ref };
}

/** Typeahead rows for a `#` token: the matching paths, then, once the token
 * names one file, that file's hunks as new-Side ranges. `#cli` offers
 * `#src/payments/client.ts`; `#src/payments/client.ts:` offers
 * `#src/payments/client.ts:40-43` and `#src/payments/client.ts:81-83`.
 * Every row parses with `parseRefToken`. */
export function suggestRefs(diff: Diff, token: string, limit = 20): string[] {
  const body = token.startsWith("#") ? token.slice(1) : token;
  const colon = body.indexOf(":");
  const name = colon === -1 ? body : body.slice(0, colon);
  const files = matchFiles(diff, name);
  const [file] = files;
  if (file !== undefined && files.length === 1 && (colon !== -1 || file.path === name)) {
    const typed = `#${file.path}:${colon === -1 ? "" : body.slice(colon + 1)}`;
    return file.hunks
      .filter((h) => h.newLines > 0)
      .map((h) => `#${file.path}:${h.newLines === 1 ? `${h.newStart}` : `${h.newStart}-${h.newStart + h.newLines - 1}`}`)
      .filter((row) => row.startsWith(typed))
      .slice(0, limit);
  }
  return files.map((f) => `#${f.path}`).slice(0, limit);
}

/** Where a ref's first line sits now: its file and the hunk holding `start`
 * on its Side, for scrolling the pane there; `hunk` is null when the file
 * is in the Diff but the line is not. */
export function hunkOfRef(diff: Diff, ref: CodeRef): { file: DiffFile; hunk: number | null } | undefined {
  const file = diff.files.find((f) => f.path === ref.file);
  if (file === undefined) return undefined;
  const index = file.hunks.findIndex((h) => h.lines.some((l) => (ref.side === "new" ? l.newNo : l.oldNo) === ref.start));
  return { file, hunk: index === -1 ? null : index };
}
