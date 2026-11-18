// Types shared between the server and the web client.

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
  /** True when the file differs from HEAD in the workspace (edited after checkout). */
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
  local?: { path: string };
  sessionId?: string;
  model: string;
  openedAt: number;
}

export interface RecentEntry {
  kind: "pr" | "local";
  label: string;
  /** PR URL or local path. */
  target: string;
  openedAt: number;
}

/** A user-selected range of diff lines, captured at selection time. */
export interface CodeRef {
  id: string;
  file: string;
  side: Side;
  start: number;
  end: number;
  lines: DiffLine[];
}

export interface ChatRequest {
  message: string;
  refs: CodeRef[];
  model?: string;
}

export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "message_start"; messageId: string }
  | { type: "text_start" }
  | { type: "text_delta"; text: string }
  | { type: "text_final"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; isError: boolean; summary: string }
  | { type: "permission_request"; requestId: string; toolName: string; input: unknown }
  | { type: "permission_resolved"; requestId: string; allowed: boolean }
  | { type: "done"; subtype: string; filesChanged: string[]; costUsd?: number; durationMs?: number; error?: string }
  | { type: "error"; message: string };

export type ChatBlock =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; status: "running" | "done" | "error"; result?: string }
  | { kind: "permission"; requestId: string; toolName: string; input: unknown; decision?: "allowed" | "denied" };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** User message text. */
  text?: string;
  refs?: CodeRef[];
  /** Assistant content. */
  blocks?: ChatBlock[];
  status?: "streaming" | "done" | "error" | "aborted";
  error?: string;
  costUsd?: number;
  durationMs?: number;
  filesChanged?: string[];
  createdAt: number;
}

export interface WorkspaceState {
  workspace: WorkspaceInfo | null;
  diff: Diff | null;
  messages: ChatMessage[];
  busy: boolean;
}

export const MODELS: { id: string; label: string }[] = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
];

export const DEFAULT_MODEL = "claude-opus-5-5";
