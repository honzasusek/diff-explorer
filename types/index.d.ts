// The mod's state contract: what diff-explorer keeps in $.state. This file
// must stay self-contained (no imports), so the shapes below mirror core's
// (core/workspace/target.ts, core/types.ts) rather than import them.
export type ReviewTarget =
  | { kind: 'pr'; number: number; owner?: string; repo?: string }
  | { kind: 'branch'; name: string }
  | { kind: 'worktree' }

export type ReviewFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied'

/** One File Change, as much of it as the pane's file list needs. */
export type ReviewFile = {
  /** The Diff's own id for the file, what the pane keys its elements by. */
  id: string
  path: string
  status: ReviewFileStatus
  additions: number
  deletions: number
  binary: boolean
  dirty: boolean
  /** Hunks hidden behind the header: large files start so, a press toggles it. */
  folded: boolean
}

/** What a Workspace resolved: enough to recompute the Diff after a reload. */
export type ReviewInfo = {
  key: string
  kind: 'pr' | 'local'
  dir: string
  baseRef: string
  baseSha: string
  headSha: string
  title: string | null
  headRefName: string | null
  baseRefName: string | null
  url: string | null
}

/** One captured line of a Code Ref: core's DiffLine. */
export type RefLine = {
  type: 'context' | 'add' | 'del'
  content: string
  oldNo: number | null
  newNo: number | null
  noNewline?: boolean
}

/** A Code Ref: core's CodeRef, lines captured with it (ADR-0003). */
export type Ref = {
  id: string
  file: string
  side: 'old' | 'new'
  start: number
  end: number
  lines: RefLine[]
}

/** The row of the first gutter press, waiting for the second; core's HunkRow. */
export type Anchor = {
  file: string
  hunk: number
  row: number
}

export type Review = {
  target: ReviewTarget
  /** A base ref typed after the target; null takes the configured default
   * for a local target, else the Workspace's own. */
  baseRef: string | null
  /** How the transcript and the pane name the target, e.g. "PR #412". */
  label: string
  openedAt: number
  /** The head row's switch: whether Claude may commit in this checkout. */
  commits: boolean
  phase: 'opening' | 'open' | 'failed'
  info: ReviewInfo | null
  files: ReviewFile[] | null
  additions: number
  deletions: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'diff-explorer': { review: Shaped<Review | null>; basket: Shaped<Ref[]>; anchor: Shaped<Anchor | null> }
  }
}
