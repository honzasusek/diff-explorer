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
  path: string
  status: ReviewFileStatus
  additions: number
  deletions: number
  binary: boolean
  dirty: boolean
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

export type Review = {
  target: ReviewTarget
  /** A base ref given on the command line, else the Workspace default. */
  baseRef: string | null
  /** How the transcript and the pane name the target, e.g. "PR #412". */
  label: string
  openedAt: number
  phase: 'opening' | 'open' | 'failed'
  info: ReviewInfo | null
  files: ReviewFile[] | null
  additions: number
  deletions: number
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'diff-explorer': { review: Shaped<Review | null> }
  }
}
