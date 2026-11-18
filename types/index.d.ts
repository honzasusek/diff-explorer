// The mod's state contract: what diff-explorer keeps in $.state. This file
// must stay self-contained (no imports), so ReviewTarget mirrors
// core/workspace/target.ts.
export type ReviewTarget =
  | { kind: 'pr'; number: number; owner?: string; repo?: string }
  | { kind: 'branch'; name: string }
  | { kind: 'worktree' }

export type Review = {
  target: ReviewTarget
  /** How the transcript and the pane name the target, e.g. "PR #412". */
  label: string
  openedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'diff-explorer': { review: Shaped<Review | null> }
  }
}
