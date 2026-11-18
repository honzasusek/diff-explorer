import type { Diff, DiffFile, DiffLine, Hunk } from "../types.ts";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function unquote(s: string): string {
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

/** Strips the a/ or b/ prefix git puts in front of paths. */
function stripPrefix(p: string): string | null {
  if (p === "/dev/null") return null;
  const u = unquote(p);
  return u.replace(/^[ab]\//, "");
}

function parseDiffGitLine(line: string): { a: string; b: string } {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    // "a/x" "b/y"
    const m = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*")$/.exec(rest);
    if (m) return { a: stripPrefix(m[1] ?? "") ?? "", b: stripPrefix(m[2] ?? "") ?? "" };
  }
  // Find a split " b/" where both halves are the same path (common case); otherwise take the first.
  let first: { a: string; b: string } | null = null;
  let idx = rest.indexOf(" b/");
  while (idx >= 0) {
    const a = rest.slice(2, idx);
    const b = rest.slice(idx + 3);
    if (!first) first = { a, b };
    if (a === b) return { a, b };
    idx = rest.indexOf(" b/", idx + 1);
  }
  return first ?? { a: rest, b: rest };
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
        file.oldPath = stripPrefix(l.slice(4));
      } else if (l.startsWith("+++ ")) {
        file.newPath = stripPrefix(l.slice(4));
        i++;
        break;
      } else if (l.startsWith("new file mode")) {
        file.status = "added";
      } else if (l.startsWith("deleted file mode")) {
        file.status = "deleted";
      } else if (l.startsWith("rename from ")) {
        file.status = "renamed";
        file.oldPath = unquote(l.slice("rename from ".length));
      } else if (l.startsWith("rename to ")) {
        file.newPath = unquote(l.slice("rename to ".length));
      } else if (l.startsWith("copy from ")) {
        file.status = "copied";
        file.oldPath = unquote(l.slice("copy from ".length));
      } else if (l.startsWith("copy to ")) {
        file.newPath = unquote(l.slice("copy to ".length));
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
