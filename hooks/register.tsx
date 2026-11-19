import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Review, ReviewFile, ReviewInfo } from '../types'
import type { Diff, WorkspaceInfo } from '../core/types.ts'
import { describeTarget, parseTarget } from '../core/workspace/target.ts'
import { createWorkspace } from '../core/workspace/workspace.ts'
import { plural, renderPane } from './pane.tsx'
import { engineRunner } from './runner.ts'
import { PANE, diffCache } from './state.ts'

// Bump the tag when Review's fields change: a reload keeps what the previous
// version stored, and a different tag reads as the initial value instead.
// The atom stays in this file: the validator reads every update's source here.
const review = atom({ plugin: 'diff-explorer', key: 'review' } as const, null, {
  shape: 'review-3',
})

/** Changed lines from which a file starts folded in the pane. */
const FOLD_THRESHOLD = 1500

/** Body columns to ask the dock for; the engine caps a dock at 45% of the terminal. */
const PANE_COLUMNS = 80

function toInfo(info: WorkspaceInfo): ReviewInfo {
  return {
    key: info.key,
    kind: info.kind,
    dir: info.dir,
    baseRef: info.baseRef,
    baseSha: info.baseSha,
    headSha: info.headSha,
    title: info.pr?.title ?? null,
    headRefName: info.pr?.headRefName ?? null,
    baseRefName: info.pr?.baseRefName ?? null,
    url: info.pr?.url ?? null,
  }
}

function toWorkspaceInfo(info: ReviewInfo): WorkspaceInfo {
  return {
    key: info.key,
    kind: info.kind,
    dir: info.dir,
    baseRef: info.baseRef,
    baseSha: info.baseSha,
    headSha: info.headSha,
  }
}

/** The file list for the state. A fold the person toggled survives a refresh;
 * a file seen for the first time starts folded when it is large. */
function summarise(diff: Diff, previous: ReviewFile[] | null): ReviewFile[] {
  const before = new Map((previous ?? []).map(f => [f.id, f]))

  return diff.files.map(f => ({
    id: f.id,
    path: f.path,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    binary: f.binary,
    dirty: f.dirty === true,
    folded: before.get(f.id)?.folded ?? f.additions + f.deletions > FOLD_THRESHOLD,
  }))
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Opens the target the state names and fills in the Diff; the pane redraws as the state changes. */
async function openCurrent($: EngineInterface, current: Review): Promise<string> {
  const sameOpen = (r: Review | null): boolean => r !== null && r.openedAt === current.openedAt
  $.ui.status(`diff-explorer: opening ${current.label}`)
  try {
    const ws = createWorkspace(engineRunner($), await $.session.cwd())
    const info = await ws.open(current.target, current.baseRef === null ? {} : { baseRef: current.baseRef })
    const diff = await ws.diff()
    diffCache.current = { key: info.key, diff }
    const opened: Review = {
      ...current,
      phase: 'open',
      info: toInfo(info),
      files: summarise(diff, null),
      additions: diff.additions,
      deletions: diff.deletions,
      error: null,
    }
    await update($, review, r => (sameOpen(r) ? opened : r))
    const base = info.pr?.baseRefName ?? info.baseRef

    return `Opened ${current.label}: ${plural(diff.files.length, 'file')}, +${diff.additions} −${diff.deletions} against ${base}.`
  } catch (err) {
    const failed: Review = { ...current, phase: 'failed', error: describeError(err) }
    await update($, review, r => (sameOpen(r) ? failed : r))

    return `Could not open ${current.label}: ${failed.error}`
  } finally {
    $.ui.status(undefined)
  }
}

/** Recomputes the Diff of an already open target, after a reload or an Edit. */
async function refresh($: EngineInterface): Promise<void> {
  const current = await read($, review)
  if (current === null || current.info === null) return
  try {
    const ws = createWorkspace(engineRunner($), await $.session.cwd(), toWorkspaceInfo(current.info))
    const diff = await ws.diff()
    diffCache.current = { key: current.info.key, diff }
    const refreshed = (r: Review): Review => ({
      ...r,
      phase: 'open',
      files: summarise(diff, r.files),
      additions: diff.additions,
      deletions: diff.deletions,
      error: null,
    })
    await update($, review, r => (r !== null && r.info !== null ? refreshed(r) : r))
  } catch (err) {
    const message = describeError(err)
    const failed = (r: Review): Review => ({ ...r, phase: 'failed', error: message })
    await update($, review, r => (r !== null ? failed(r) : r))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'explore',
      description: 'Open a pull request or branch diff in a pane beside the chat',
      argumentHint: '<number | url | owner/repo#n | branch | .> [base ref]',
    })
    const current = await read($, review)
    if (current !== null) {
      void $.ui.open({ id: PANE, title: 'diff', columns: PANE_COLUMNS })
      void refresh($)
    }

    return next(e)
  })

  on('command.run', { command: 'explore' }, async ($, e) => {
    const [first = '', baseRef] = e.args.trim().split(/\s+/)
    const target = parseTarget(first)
    if (!target) {
      return { text: 'Usage: /explore <number | url | owner/repo#n | branch | .> [base ref]' }
    }
    const opening: Review = {
      target,
      baseRef: baseRef ?? null,
      label: describeTarget(target),
      openedAt: await $.clock.now(),
      phase: 'opening',
      info: null,
      files: null,
      additions: 0,
      deletions: 0,
      error: null,
    }
    diffCache.current = null
    await update($, review, () => opening)
    await $.ui.open({ id: PANE, title: 'diff', columns: PANE_COLUMNS })

    return { text: await openCurrent($, opening) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, review)

    return renderPane($, e, current, {
      toggleFold: id =>
        void update($, review, r =>
          r === null || r.files === null
            ? r
            : { ...r, files: r.files.map(f => (f.id === id ? { ...f, folded: !f.folded } : f)) },
        ),
    })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, review)
    if (e.props.hasSurvey || current === null || current.phase !== 'open') {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>refs: none</Text>
      </Box>
    )
  })
}
