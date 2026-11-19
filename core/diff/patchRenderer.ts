// The inverse of the parser: a DiffFile back to unified-diff text. The pane
// feeds one hunk at a time to the engine's Code element, and synthesised
// files (untracked, edits-only views) get a patch git never produced.
// Round-trip tested: parseUnifiedDiff(renderPatch(f)) equals f.
import type { DiffFile, DiffLine, Hunk } from "../types.ts";

const NEEDS_QUOTE_RE = /["\\\x00-\x1f\x7f]/;

/** git's C-style quoting with core.quotePath=false: non-ASCII stays raw. */
export function quotePath(path: string): string {
  if (!NEEDS_QUOTE_RE.test(path)) return path;
  let out = '"';
  for (const ch of path) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += "\\" + code.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out + '"';
}

function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

export function renderHunkHeader(hunk: Hunk): string {
  const head = `@@ -${range(hunk.oldStart, hunk.oldLines)} +${range(hunk.newStart, hunk.newLines)} @@`;
  return hunk.header ? `${head} ${hunk.header}` : head;
}

const MARKERS: Record<DiffLine["type"], string> = { context: " ", add: "+", del: "-" };

export function renderLine(line: DiffLine, noNewlineNote = true): string {
  const text = MARKERS[line.type] + line.content;
  return noNewlineNote && line.noNewline ? `${text}\n\\ No newline at end of file` : text;
}

/** One hunk as git prints it: the @@ header and its lines, no trailing
 * newline. Without the note, a hunk is exactly one row per line, which the
 * pane's gutter and row model count on. */
export function renderHunk(hunk: Hunk, options: { noNewlineNote?: boolean } = {}): string {
  const note = options.noNewlineNote ?? true;
  return [renderHunkHeader(hunk), ...hunk.lines.map((line) => renderLine(line, note))].join("\n");
}

/** One file's whole patch, ending with a newline, as `git diff` would print it. */
export function renderPatch(file: DiffFile): string {
  const oldName = file.oldPath ?? file.path;
  const newName = file.newPath ?? file.path;
  const oldSide = file.oldPath === null ? "/dev/null" : quotePath(`a/${oldName}`);
  const newSide = file.newPath === null ? "/dev/null" : quotePath(`b/${newName}`);
  const out = [`diff --git ${quotePath(`a/${oldName}`)} ${quotePath(`b/${newName}`)}`];
  switch (file.status) {
    case "added":
      out.push("new file mode 100644");
      break;
    case "deleted":
      out.push("deleted file mode 100644");
      break;
    case "renamed":
      out.push(`rename from ${quotePath(oldName)}`, `rename to ${quotePath(newName)}`);
      break;
    case "copied":
      out.push(`copy from ${quotePath(oldName)}`, `copy to ${quotePath(newName)}`);
      break;
    case "modified":
      break;
  }
  if (file.binary) {
    out.push(`Binary files ${oldSide} and ${newSide} differ`);
  } else if (file.hunks.length > 0) {
    out.push(`--- ${oldSide}`, `+++ ${newSide}`, ...file.hunks.map((hunk) => renderHunk(hunk)));
  }
  return out.join("\n") + "\n";
}
