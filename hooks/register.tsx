import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Review, ReviewFile, ReviewInfo } from '../types'
import type { CodeRef, Diff, DiffFile, HunkRow, WorkspaceInfo } from '../core/types.ts'
import { basketReducer } from '../core/basket/basketReducer.ts'
import { fileKey, hunkKey } from '../core/diff/layout.ts'
import { hunkOfRef, refLabel, refsInText, renderRefs, suggestRefs } from '../core/diff/refs.ts'
import { captureFile, captureHunk, captureRows, gutterPress } from '../core/diff/selection.ts'
import { describeTarget, parseTarget } from '../core/workspace/target.ts'
import { createWorkspace } from '../core/workspace/workspace.ts'
import { renderBand } from './band.tsx'
import type { BandActions } from './band.tsx'
import { runAdd, runRef, runRefs } from './commands.ts'
import type { Outcome } from './commands.ts'
import { plural, renderPane } from './pane.tsx'
import type { PaneActions } from './pane.tsx'
import { engineRunner } from './runner.ts'
import { PANE, diffCache } from './state.ts'

// Bump the tag when Review's fields change: a reload keeps what the previous
// version stored, and a different tag reads as the initial value instead.
// The atom stays in this file: the validator reads every update's source here.
const review = atom({ plugin: 'diff-explorer', key: 'review' } as const, null, {
  shape: 'review-3',
})
/** The Basket: the Code Refs the next prompt carries. */
const basket = atom({ plugin: 'diff-explorer', key: 'basket' } as const, [], { shape: 'basket-1' })
/** The gutter row of the first press, until the second completes the range. */
const anchor = atom({ plugin: 'diff-explorer', key: 'anchor' } as const, null, { shape: 'anchor-1' })

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

/** The Diff of the open review, or null while none is open or loaded. */
async function openDiff($: EngineInterface): Promise<Diff | null> {
  const current = await read($, review)
  const cached = diffCache.current

  return current?.info !== null && current?.info !== undefined && cached?.key === current.info.key ? cached.diff : null
}

/** Puts a ref in the Basket and says whether it was new there. */
async function addRef($: EngineInterface, ref: CodeRef): Promise<Outcome> {
  let outcome: Outcome = 'present'
  await update($, basket, b => {
    const next = basketReducer(b, { type: 'add', ref })
    outcome = next === b ? 'present' : 'added'

    return next
  })

  return outcome
}

/** A press in the pane that captured something: adds it and says so in a toast. */
async function addCaptured($: EngineInterface, ref: CodeRef | undefined): Promise<void> {
  if (ref === undefined) return
  const outcome = await addRef($, ref)
  $.ui.toast(outcome === 'added' ? `Added ${refLabel(ref)} to the refs` : `${refLabel(ref)} is already in the refs`)
}

/** The gutter gesture (core/diff/selection.ts): the anchor moves, clears, or
 * the completed range of rows becomes a ref. */
async function gutterPressed($: EngineInterface, row: HunkRow): Promise<void> {
  const press = gutterPress(await read($, anchor), row)
  await update($, anchor, () => (press.kind === 'anchor' ? press.anchor : null))
  if (press.kind !== 'range') return
  const file = diffCache.current?.diff.files.find(f => f.path === press.file)
  if (file !== undefined) await addCaptured($, captureRows(file, press.hunk, press.from, press.to))
}

/** Scrolls the pane to where a ref's lines are now: its hunk, or the file
 * header when the file is folded or the line is gone. */
async function showRef($: EngineInterface, ref: CodeRef): Promise<void> {
  const diff = await openDiff($)
  const at = diff === null ? undefined : hunkOfRef(diff, ref)
  if (at === undefined) {
    $.ui.toast(`${refLabel(ref)} is not in the diff any more`)

    return
  }
  const current = await read($, review)
  const folded = current?.files?.find(f => f.id === at.file.id)?.folded === true
  const key = at.hunk === null || folded ? fileKey(at.file.id) : hunkKey(at.file.id, at.hunk)
  const scrolled = await $.ui.scroll({ in: PANE, to: { key }, block: 'start' }).catch(err => ({ deny: describeError(err) }))
  if (scrolled.deny !== undefined) $.ui.log(`diff-explorer: could not scroll to ${key}: ${scrolled.deny}`)
}

function bandActions($: EngineInterface): BandActions {
  const log = (what: string) => (err: unknown) => $.ui.log(`diff-explorer: ${what} failed: ${describeError(err)}`)

  return {
    show: ref => void showRef($, ref).catch(log('chip')),
    remove: id => void update($, basket, b => basketReducer(b, { type: 'remove', id })).catch(log('[x]')),
    addSelection: () =>
      void openDiff($)
        .then(diff => runAdd($, diff, ref => addRef($, ref)))
        .then(text => $.ui.toast(text))
        .catch(log('[add selection]')),
    clear: () => void update($, basket, () => []).catch(log('[clear]')),
  }
}

function paneActions($: EngineInterface): PaneActions {
  const log = (what: string) => (err: unknown) => $.ui.log(`diff-explorer: ${what} failed: ${describeError(err)}`)

  return {
    toggleFold: id =>
      void update($, review, r =>
        r === null || r.files === null
          ? r
          : { ...r, files: r.files.map(f => (f.id === id ? { ...f, folded: !f.folded } : f)) },
      ).catch(log('fold')),
    pressGutter: row => void gutterPressed($, row).catch(log('gutter press')),
    addHunk: (file: DiffFile, index: number) => void addCaptured($, captureHunk(file, index)).catch(log('+hunk')),
    addFile: (file: DiffFile) => void addCaptured($, captureFile(file)).catch(log('+file')),
  }
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
    await $.command.register({
      name: 'add',
      description: 'Add the lines selected in the diff pane to the refs for the next prompt',
    })
    await $.command.register({
      name: 'ref',
      description: 'Add a typed line range of the diff to the refs for the next prompt',
      argumentHint: 'path:from-to [old]',
    })
    await $.command.register({
      name: 'refs',
      description: 'List the refs waiting for the next prompt, or clear them',
      argumentHint: '[clear]',
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
    await update($, basket, () => [])
    await update($, anchor, () => null)
    await $.ui.open({ id: PANE, title: 'diff', columns: PANE_COLUMNS })

    return { text: await openCurrent($, opening) }
  })

  on('command.run', { command: 'add' }, async $ => ({
    text: await runAdd($, await openDiff($), ref => addRef($, ref)),
  }))

  on('command.run', { command: 'ref' }, async ($, e) => ({
    text: await runRef(e.args, await openDiff($), ref => addRef($, ref)),
  }))

  on('command.run', { command: 'refs' }, async ($, e) => ({
    text: await runRefs(e.args, await read($, basket), () => update($, basket, () => []).then(() => undefined)),
  }))

  // The refs ride along as code_ref blocks after the prompt's own words, the
  // Basket's first and then those typed as #path:from-to tokens, and the
  // Basket empties once the prompt has entered. A slash command's line and a
  // hidden prompt take no rewrite, so they pass untouched.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    const diff = await openDiff($)
    const typed = diff === null ? { refs: [], errors: [] } : refsInText(diff, e.text)
    for (const error of typed.errors) $.ui.toast(error)
    const refs = typed.refs.reduce((all, ref) => basketReducer(all, { type: 'add', ref }), await read($, basket))
    if (refs.length === 0) return next(e)
    const result = await next({ ...e, text: `${e.text}\n\n${renderRefs(refs)}` })
    if (result.drop === undefined) await update($, basket, () => [])

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    renderPane($, e, await read($, review), await read($, anchor), paneActions($)),
  )

  // Typeahead for a #path:from-to token: the diff's paths, then one file's hunks.
  on('prompt.autocomplete', { token: /^#/ }, async ($, e, next) => {
    const diff = await openDiff($)
    const below = await next(e)
    if (diff === null) return below

    return { suggestions: [...suggestRefs(diff, e.token).map(text => ({ text })), ...below.suggestions] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, review)
    if (e.props.hasSurvey || current === null || current.phase !== 'open') {
      return next(e)
    }

    return renderBand($, e, await read($, basket), bandActions($))
  })
}
