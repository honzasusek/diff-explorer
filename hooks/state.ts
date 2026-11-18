import type { Diff } from '../core/types.ts'

// Not 'diff': the engine has a site of that name and answers its scroll
// itself, so a pane opened as 'diff' never scrolls (research note, Limits).
export const PANE = 'explore'

// The parsed Diff is large and lives here, not in $.state. A reload empties
// it; session.start recomputes it from the stored ReviewInfo. `key` is the
// WorkspaceInfo key the Diff belongs to, so a stale Diff is never drawn.
export const diffCache: { current: { key: string; diff: Diff } | null } = { current: null }
