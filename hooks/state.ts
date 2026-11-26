import type { Diff } from '../core/types.ts'
import type { Layout } from '../core/diff/layout.ts'

// Not 'diff': the engine has a site of that name and answers its scroll
// itself, so a pane opened as 'diff' never scrolls (research note, Limits).
export const PANE = 'explore'

// The parsed Diff is large and lives here, not in $.state. A reload empties
// it; session.start recomputes it from the stored ReviewInfo. `key` is the
// WorkspaceInfo key the Diff belongs to, so a stale Diff is never drawn.
export const diffCache: { current: { key: string; diff: Diff } | null } = { current: null }

// The terminal pane scrolls its diff itself, under a head that stays put
// (pane.tsx). Each terminal drawing leaves its row layout here, so a scroll
// knows how far it may go and a chip can find a hunk's row. `windowRows` is
// the diff's room under the head, `maxTop` the last row the window may start
// at. Null while the terminal draws no diff.
export const paneWindow: { current: { layout: Layout; windowRows: number; maxTop: number } | null } = { current: null }
