// Domain types. Everything here is JSON-serialisable (the core rule, ADR-0004).

export type Side = "old" | "new";

export type LineType = "context" | "add" | "del";

export interface DiffLine {
  type: LineType;
  content: string;
  oldNo: number | null;
  newNo: number | null;
  /** Set when the file has no trailing newline after this line. */
  noNewline?: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Function context captured by git after the @@ markers. */
  header: string;
  lines: DiffLine[];
}

export type FileStatus = "added" | "deleted" | "modified" | "renamed" | "copied";

export interface DiffFile {
  /** Stable id derived from the display path. */
  id: string;
  oldPath: string | null;
  newPath: string | null;
  /** Display path: new path, or old path for deleted files. */
  path: string;
  status: FileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  /** True when the file differs from the committed Head (a Dirty File). */
  dirty?: boolean;
}

export interface Diff {
  files: DiffFile[];
  additions: number;
  deletions: number;
}

export interface PRMeta {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  state: string;
  isDraft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface WorkspaceInfo {
  key: string;
  kind: "pr" | "local";
  dir: string;
  /** Ref the diff is computed against (e.g. origin/main). */
  baseRef: string;
  /** Merge-base commit the diff is computed from. */
  baseSha: string;
  headSha: string;
  pr?: PRMeta;
  openedAt: number;
}

/** A range of diff lines on one Side of one file, captured with its text (ADR-0003). */
export interface CodeRef {
  id: string;
  file: string;
  side: Side;
  start: number;
  end: number;
  lines: DiffLine[];
}
