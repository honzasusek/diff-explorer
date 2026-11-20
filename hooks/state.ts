import type { Diff } from '../core/types.ts'

// Not 'diff': the engine has a site of that name and answers its scroll
// itself, so a pane opened as 'diff' never scrolls (research note, Limits).
export const PANE = 'explore'

// The parsed Diff is large and lives here, not in $.state. A reload empties
// it; session.start recomputes it from the stored ReviewInfo. `key` is the
// WorkspaceInfo key the Diff belongs to, so a stale Diff is never drawn.
export const diffCache: { current: { key: string; diff: Diff } | null } = { current: null }

// A glide of the pane's window in flight (core/diff/glide.ts): the offsets
// still to step through and the timer of the next step. `shown` is the
// window's offset as the pane last drew it, where a new glide starts from.
// A reload drops it all; the window simply stays where it is.
export const motion: {
  shown: number
  bodyRows: number
  steps: number[]
  /** The key a chip asked for: the glide's last step goes there exactly. */
  target: string | null
  timer: { cancel(): void } | null
} = { shown: 0, bodyRows: 0, steps: [], target: null, timer: null }

// The keyed elements of the last drawing by their top row, in order: a file
// header, a hunk, a gutter row. A glide step scrolls to the one at or above
// its offset, since the engine scrolls a plugin's pane only to a key and a
// plugin's own scroll does not reach its own ui.scroll hook.
export const rowKeys: { top: number; key: string }[] = []
