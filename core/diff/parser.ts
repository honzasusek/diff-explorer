import type { Diff, DiffFile, DiffLine, Hunk } from "../types.ts";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const OCTAL_RE = /^[0-7]{1,3}/;
const SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  a: "\x07",
  b: "\b",
  f: "\f",
  v: "\v",
  "\\": "\\",
  '"': '"',
};

/** Decodes UTF-8 bytes without TextDecoder, which core cannot assume. */
function decodeUtf8(bytes: number[]): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i] ?? 0;
    let cp: number;
    let n: number;
    if (b0 < 0x80) {
      cp = b0;
      n = 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      n = 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      n = 3;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      n = 4;
    } else {
      out += "�";
      i++;
      continue;
    }
    if (i + n > bytes.length) {
      out += "�";
      break;
    }
    for (let k = 1; k < n; k++) cp = (cp << 6) | ((bytes[i + k] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

/** Undoes git's C-style path quoting: "caf\303\251 \"x\".txt" -> café "x".txt */
export function cUnquote(s: string): string {
  if (!(s.startsWith('"') && s.endsWith('"') && s.length >= 2)) return s;
  const inner = s.slice(1, -1);
  let out = "";
  let bytes: number[] = [];
  const flush = (): void => {
    if (bytes.length > 0) {
      out += decodeUtf8(bytes);
      bytes = [];
    }
  };
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] ?? "";
    if (ch !== "\\") {
      flush();
      out += ch;
      continue;
    }
    const octal = OCTAL_RE.exec(inner.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += octal[0].length;
      continue;
    }
    flush();
    const next = inner[i + 1] ?? "";
    out += SIMPLE_ESCAPES[next] ?? next;
    i += 1;
  }
  flush();
  return out;
}

/** Reads a quoted token starting at `start`; returns the raw token and where it ends. */
function readQuoted(s: string, start: number): { raw: string; end: number } | null {
  if (s[start] !== '"') return null;
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === '"') return { raw: s.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

/** Unquotes and strips the a/ or b/ prefix git puts in front of paths; /dev/null is null. */
function stripPrefix(p: string): string | null {
  if (p === "/dev/null") return null;
  return cUnquote(p).replace(/^[ab]\//, "");
}

/** The path on a `--- ` or `+++ ` line: git appends a tab when the path has spaces. */
function headerPath(rest: string): string | null {
  return stripPrefix(rest.replace(/\t$/, ""));
}

function parseDiffGitLine(line: string): { a: string; b: string } {
  const rest = line.slice("diff --git ".length);
  const first = readQuoted(rest, 0);
  if (first) {
    const after = rest.slice(first.end).replace(/^ /, "");
    const second = readQuoted(after, 0);
    return { a: stripPrefix(first.raw) ?? "", b: stripPrefix(second ? second.raw : after) ?? "" };
  }
  const quotedSecond = rest.indexOf(' "');
  if (quotedSecond >= 0) {
    return { a: stripPrefix(rest.slice(0, quotedSecond)) ?? "", b: stripPrefix(rest.slice(quotedSecond + 1)) ?? "" };
  }
  // Unquoted paths may contain spaces: find a split " b/" where both halves
  // are the same path (the common case); otherwise take the first split.
  let firstSplit: { a: string; b: string } | null = null;
  let idx = rest.indexOf(" b/");
  while (idx >= 0) {
    const a = rest.slice(2, idx);
    const b = rest.slice(idx + 3);
    if (!firstSplit) firstSplit = { a, b };
    if (a === b) return { a, b };
    idx = rest.indexOf(" b/", idx + 1);
  }
  return firstSplit ?? { a: rest, b: rest };
}

export function fileId(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, "-");
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  const lines = text.split("\n");
  const files: DiffFile[] = [];
  let i = 0;
  const at = (n: number): string => lines[n] ?? "";
  while (i < lines.length) {
    const line = at(i);
    if (!line.startsWith("diff --git ")) {
      i++;
      continue;
    }
    const { a, b } = parseDiffGitLine(line);
    const file: DiffFile = {
      id: "",
      oldPath: a,
      newPath: b,
      path: b,
      status: "modified",
      binary: false,
      additions: 0,
      deletions: 0,
      hunks: [],
    };
    i++;
    // Extended header lines.
    while (i < lines.length && !at(i).startsWith("diff --git ")) {
      const l = at(i);
      if (l.startsWith("--- ")) {
        file.oldPath = headerPath(l.slice(4));
      } else if (l.startsWith("+++ ")) {
        file.newPath = headerPath(l.slice(4));
        i++;
        break;
      } else if (l.startsWith("new file mode")) {
        file.status = "added";
      } else if (l.startsWith("deleted file mode")) {
        file.status = "deleted";
      } else if (l.startsWith("rename from ")) {
        file.status = "renamed";
        file.oldPath = cUnquote(l.slice("rename from ".length));
      } else if (l.startsWith("rename to ")) {
        file.newPath = cUnquote(l.slice("rename to ".length));
      } else if (l.startsWith("copy from ")) {
        file.status = "copied";
        file.oldPath = cUnquote(l.slice("copy from ".length));
      } else if (l.startsWith("copy to ")) {
        file.newPath = cUnquote(l.slice("copy to ".length));
      } else if (l.startsWith("Binary files") || l.startsWith("GIT binary patch")) {
        file.binary = true;
      } else if (HUNK_RE.test(l)) {
        // Hunk without ---/+++ (shouldn't happen, but don't skip it).
        break;
      }
      i++;
    }
    if (file.oldPath === null && file.status === "modified") file.status = "added";
    if (file.newPath === null && file.status === "modified") file.status = "deleted";
    // The `diff --git` line names both sides even when one does not exist.
    if (file.status === "added") file.oldPath = null;
    if (file.status === "deleted") file.newPath = null;

    // Hunks.
    let hunk: Hunk | null = null;
    let oldRemaining = 0;
    let newRemaining = 0;
    let oldNo = 0;
    let newNo = 0;
    while (i < lines.length && !at(i).startsWith("diff --git ")) {
      const l = at(i);
      const hm = HUNK_RE.exec(l);
      if (hm) {
        hunk = {
          oldStart: Number(hm[1]),
          oldLines: hm[2] === undefined ? 1 : Number(hm[2]),
          newStart: Number(hm[3]),
          newLines: hm[4] === undefined ? 1 : Number(hm[4]),
          header: hm[5] ?? "",
          lines: [],
        };
        file.hunks.push(hunk);
        oldRemaining = hunk.oldLines;
        newRemaining = hunk.newLines;
        oldNo = hunk.oldStart;
        newNo = hunk.newStart;
        i++;
        continue;
      }
      if (!hunk) {
        i++;
        continue;
      }
      if (l.startsWith("\\")) {
        const prev = hunk.lines[hunk.lines.length - 1];
        if (prev) prev.noNewline = true;
        i++;
        continue;
      }
      if (oldRemaining <= 0 && newRemaining <= 0) {
        // Hunk complete; anything else before the next file header is noise.
        i++;
        continue;
      }
      const marker = l[0];
      const content = l.slice(1);
      let dl: DiffLine;
      if (marker === "+") {
        dl = { type: "add", content, oldNo: null, newNo: newNo++ };
        newRemaining--;
        file.additions++;
      } else if (marker === "-") {
        dl = { type: "del", content, oldNo: oldNo++, newNo: null };
        oldRemaining--;
        file.deletions++;
      } else {
        // ' ' or an empty line (some tools strip the trailing space).
        dl = { type: "context", content: marker === " " ? content : l, oldNo: oldNo++, newNo: newNo++ };
        oldRemaining--;
        newRemaining--;
      }
      hunk.lines.push(dl);
      i++;
    }
    file.path = file.newPath ?? file.oldPath ?? "";
    file.id = fileId(file.path);
    files.push(file);
  }
  return files;
}

export function buildDiff(files: DiffFile[]): Diff {
  return {
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
}
