import type { Diff } from '../core/types.ts'

export const PANE = 'diff'

// The parsed Diff is large and lives here, not in $.state. A reload empties
// it; session.start recomputes it from the stored ReviewInfo. `key` is the
// WorkspaceInfo key the Diff belongs to, so a stale Diff is never drawn.
export const diffCache: { current: { key: string; diff: Diff } | null } = { current: null }
