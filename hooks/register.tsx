import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DiffView, Review, ReviewFile, ReviewInfo } from '../types'
import type { CodeRef, Diff, DiffFile, HunkRow, WorkspaceInfo } from '../core/types.ts'
import { basketReducer, markStale } from '../core/basket/basketReducer.ts'
import { readConfig } from '../core/config.ts'
import type { Config } from '../core/config.ts'
import { fileKey, hunkKey } from '../core/diff/layout.ts'
import { hunkOfRef, promptWithRefs, refLabel, refsInText, suggestRefs } from '../core/diff/refs.ts'
import { captureFile, captureHunk, captureRows, gutterPress } from '../core/diff/selection.ts'
import { SECTION_ID, reviewSection } from '../core/prompt/reviewSection.ts'
import type { ReviewSummary } from '../core/prompt/reviewSection.ts'
import { isGitCommit } from '../core/workspace/gitCommand.ts'
import { isInside, recentFor, recentReviews, remember } from '../core/workspace/recent.ts'
import type { Remembered } from '../core/workspace/recent.ts'
import { explainError } from '../core/workspace/errors.ts'
import { describeTarget, parseTarget } from '../core/workspace/target.ts'
import { createWorkspace } from '../core/workspace/workspace.ts'
import { renderBand } from './band.tsx'
import type { BandActions } from './band.tsx'
import { runAdd, runRef, runRefs, runRevert } from './commands.ts'
import type { Outcome } from './commands.ts'
import { plural, renderPane } from './pane.tsx'
import type { PaneActions } from './pane.tsx'
import { engineRunner } from './runner.ts'
import { PANE, diffCache } from './state.ts'

// Bump the tag when Review's fields change: a reload keeps what the previous
// version stored, and a different tag reads as the initial value instead.
// The atom stays in this file: the validator reads every update's source here.
const review = atom({ plugin: 'diff-explorer', key: 'review' } as const, null, {
  shape: 'review-4',
})
/** The Basket: the Code Refs the next prompt carries. */
const basket = atom({ plugin: 'diff-explorer', key: 'basket' } as const, [], { shape: 'basket-1' })
/** The gutter row of the first press, until the second completes the range. */
const anchor = atom({ plugin: 'diff-explorer', key: 'anchor' } as const, null, { shape: 'anchor-1' })
/** How the pane draws hunks: one column, or the old side beside the new. */
const view = atom({ plugin: 'diff-explorer', key: 'view' } as const, 'unified', { shape: 'view-1' })

/** Body columns to ask the dock for: more than any terminal has, so the
 * dock opens as wide as the engine allows, 45% of the terminal (on a 220
 * column terminal, 99 columns). A width the person drags still wins. */
const PANE_COLUMNS = 10_000

/** The store key of the last target per repository (core/workspace/recent.ts). */
const RECENT_KEY = 'recent'

/** The store key of the pane's view: a habit of the person's, the same in every repository. */
const VIEW_KEY = 'view'

const EXPLORE_USAGE = 'Usage: /explore <number | url | owner/repo#n | branch | .> [base ref]'

const COMMITS_OFF = 'Commits are off for this review: the "auto-commit" switch in the diff pane turns them on.'

/** The switch's first setting for a target nothing is remembered for: off
 * for a pull request, whose branch is someone else's, on for the person's
 * own tree or branch. */
function defaultCommits(target: Review['target']): boolean {
  return target.kind !== 'pr'
}

/** What the store keeps of the open review: the target and the switch. */
function remembered(current: Review): Remembered {
  return { target: current.target, baseRef: current.baseRef, commits: current.commits }
}

/** The record of the repository the session is in, or nothing: a store that
 * cannot be read must not keep /explore from opening. */
async function lastReview($: EngineInterface): Promise<Remembered | undefined> {
  try {
    return recentFor(recentReviews(await $.store.get(RECENT_KEY)), await $.session.cwd())
  } catch (err) {
    $.ui.log(`diff-explorer: could not read the store: ${describeError(err)}`)

    return undefined
  }
}

async function rememberReview($: EngineInterface, current: Review, dir: string): Promise<void> {
  try {
    const recent = recentReviews(await $.store.get(RECENT_KEY))
    await $.store.set(RECENT_KEY, remember(recent, dir, remembered(current)))
  } catch (err) {
    $.ui.log(`diff-explorer: could not remember ${current.label}: ${describeError(err)}`)
  }
}

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
 * a file seen for the first time starts folded when its changed lines pass
 * `foldLines`. */
function summarise(diff: Diff, previous: ReviewFile[] | null, foldLines: number): ReviewFile[] {
  const before = new Map((previous ?? []).map(f => [f.id, f]))

  return diff.files.map(f => ({
    id: f.id,
    path: f.path,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    binary: f.binary,
    dirty: f.dirty === true,
    folded: before.get(f.id)?.folded ?? f.additions + f.deletions > foldLines,
  }))
}

/** What the system prompt says of an open review; null while none is open. */
function summaryOf(current: Review | null): ReviewSummary | null {
  if (current === null || current.phase !== 'open' || current.info === null || current.files === null) return null
  const info = current.info

  return {
    label: current.label,
    title: info.title,
    head: info.headRefName ?? info.headSha.slice(0, 7),
    base: info.baseRefName ?? info.baseRef,
    baseSha: info.baseSha,
    url: info.url,
    files: current.files.map(f => ({ path: f.path, status: f.status })),
    commits: current.commits,
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Opens or retitles the pane. The rows are for the inline seat above the
 * prompt; the dock takes its own width from `columns`. */
function openPane($: EngineInterface, config: Config): Promise<unknown> {
  return $.ui.open({
    id: PANE,
    title: 'diff',
    columns: PANE_COLUMNS,
    ...(config.inlineRows === null ? {} : { rows: config.inlineRows }),
  })
}

/** Says why a Workspace call failed, in a toast with the hint, and logs the tool's own words. */
function reportFailure($: EngineInterface, what: string, err: unknown): string {
  const explained = explainError(err)
  $.ui.toast(`${what}: ${explained}`, { timeoutMs: 8000 })
  const detail = err instanceof Error && 'detail' in err && typeof err.detail === 'string' ? err.detail : ''
  if (detail !== '') $.ui.log(`diff-explorer: ${what}: ${detail}`)

  return explained
}

/** The Diff of the open review, or null while none is open or loaded. */
async function openDiff($: EngineInterface): Promise<Diff | null> {
  const current = await read($, review)
  const cached = diffCache.current

  return current?.info !== null && current?.info !== undefined && cached?.key === current.info.key ? cached.diff : null
}

/** The ids of the refs whose lines the open Diff no longer holds as captured. */
async function staleIds($: EngineInterface, refs: CodeRef[]): Promise<Set<string>> {
  const diff = await openDiff($)

  return new Set(diff === null ? [] : markStale(refs, diff))
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
    toggleCommits: () => void toggleCommits($).catch(log('commits switch')),
    toggleView: () => void toggleView($).catch(log('view switch')),
    addHunk: (file: DiffFile, index: number) => void addCaptured($, captureHunk(file, index)).catch(log('+hunk')),
    addFile: (file: DiffFile) => void addCaptured($, captureFile(file)).catch(log('+file')),
  }
}

/** Flips the commits switch and remembers it for the repository. */
async function toggleCommits($: EngineInterface): Promise<void> {
  const current = await read($, review)
  if (current === null) return
  const commits = !current.commits
  await update($, review, r => (r === null ? r : { ...r, commits }))
  if (current.info !== null) await rememberReview($, { ...current, commits }, current.info.dir)
}

/** Flips the pane between unified and side by side and remembers it for
 * every later session. A store that cannot be written only loses the memory. */
async function toggleView($: EngineInterface): Promise<void> {
  const next: DiffView = (await read($, view)) === 'split' ? 'unified' : 'split'
  await update($, view, () => next)
  try {
    await $.store.set(VIEW_KEY, next)
  } catch (err) {
    $.ui.log(`diff-explorer: could not remember the view: ${describeError(err)}`)
  }
}

/** The view the store remembers, else unified. */
async function storedView($: EngineInterface): Promise<DiffView> {
  try {
    return (await $.store.get(VIEW_KEY)) === 'split' ? 'split' : 'unified'
  } catch {
    return 'unified'
  }
}

/** Opens the target the state names and fills in the Diff; the pane redraws as the state changes. */
async function openCurrent($: EngineInterface, current: Review, config: Config): Promise<string> {
  const sameOpen = (r: Review | null): boolean => r !== null && r.openedAt === current.openedAt
  $.ui.status(`diff-explorer: opening ${current.label}`)
  try {
    const ws = createWorkspace(engineRunner($), await $.session.cwd())
    // A typed base ref wins, then the configured one for the person's own
    // tree or branch; a pull request knows its base branch.
    const baseRef = current.baseRef ?? (current.target.kind === 'pr' ? null : config.baseRef)
    const info = await ws.open(current.target, baseRef === null ? {} : { baseRef })
    const diff = await ws.diff()
    diffCache.current = { key: info.key, diff }
    const opened: Review = {
      ...current,
      phase: 'open',
      info: toInfo(info),
      files: summarise(diff, null, config.foldLines),
      additions: diff.additions,
      deletions: diff.deletions,
      error: null,
    }
    await update($, review, r => (sameOpen(r) ? opened : r))
    await rememberReview($, opened, info.dir)
    const base = info.pr?.baseRefName ?? info.baseRef

    return `Opened ${current.label}: ${plural(diff.files.length, 'file')}, +${diff.additions} −${diff.deletions} against ${base}.`
  } catch (err) {
    const failed: Review = { ...current, phase: 'failed', error: explainError(err) }
    await update($, review, r => (sameOpen(r) ? failed : r))

    return `Could not open ${current.label}: ${failed.error}`
  } finally {
    $.ui.status(undefined)
  }
}

/** Recomputes the Diff of an already open target, after a reload, an Edit or
 * a revert. The gutter anchor goes too: its row may have moved. A failure is
 * toasted: no command answers in the transcript for these. */
async function refresh($: EngineInterface, config: Config): Promise<void> {
  const current = await read($, review)
  if (current === null || current.info === null) return
  await update($, anchor, () => null)
  try {
    const ws = createWorkspace(engineRunner($), await $.session.cwd(), toWorkspaceInfo(current.info))
    const diff = await ws.diff()
    diffCache.current = { key: current.info.key, diff }
    const refreshed = (r: Review): Review => ({
      ...r,
      phase: 'open',
      files: summarise(diff, r.files, config.foldLines),
      additions: diff.additions,
      deletions: diff.deletions,
      error: null,
    })
    await update($, review, r => (r !== null && r.info !== null ? refreshed(r) : r))
  } catch (err) {
    const message = reportFailure($, 'Could not refresh the diff', err)
    const failed = (r: Review): Review => ({ ...r, phase: 'failed', error: message })
    await update($, review, r => (r !== null ? failed(r) : r))
  }
}

export const register: Register = (on, options) => {
  const config = readConfig(options)

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
    await $.command.register({
      name: 'revert',
      description: 'Restore a file Claude edited to its committed version, after a confirmation',
      argumentHint: '<path>',
    })
    const remembered = await storedView($)
    await update($, view, () => remembered)
    // A review kept from before a reload comes back, unless the session now
    // runs outside its checkout: this build raises no event for a directory
    // change, so the start is where it shows.
    const current = await read($, review)
    if (current !== null && current.info !== null && !isInside(e.cwd, current.info.dir)) {
      diffCache.current = null
      await update($, review, () => null)
      await update($, basket, () => [])
      await update($, anchor, () => null)
    } else if (current !== null) {
      void openPane($, config)
      void refresh($, config)
    }

    return next(e)
  })

  on('command.run', { command: 'explore' }, async ($, e) => {
    const [first = '', typedBase] = e.args.trim().split(/\s+/)
    let target = parseTarget(first)
    let baseRef = typedBase ?? null
    const last = await lastReview($)
    if (first === '') {
      // No argument: the last target opened in this repository.
      if (last === undefined) return { text: `Nothing to reopen here. ${EXPLORE_USAGE}` }
      target = last.target
      baseRef = last.baseRef
    }
    if (!target) return { text: EXPLORE_USAGE }
    const opening: Review = {
      target,
      baseRef,
      commits: last?.commits ?? defaultCommits(target),
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
    await openPane($, config)

    return { text: await openCurrent($, opening, config) }
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

  on('command.run', { command: 'revert' }, async ($, e) => {
    const current = await read($, review)
    const info = current?.info ?? null

    return {
      text: await runRevert(e.args, current?.files ?? null, {
        confirm: path =>
          $.ui
            .ask(`Revert ${path}? Its uncommitted changes are lost; a file not yet committed is deleted.`, ['Revert', 'Keep'])
            .then(
              answer => answer === 'Revert',
              () => false,
            ),
        revert: async path => {
          if (info === null) throw new Error('nothing is open')
          await createWorkspace(engineRunner($), await $.session.cwd(), toWorkspaceInfo(info)).revert(path)
          await refresh($, config)
        },
      }),
    }
  })

  // With the switch off, a git commit Claude runs is refused and the model
  // reads why. The handler keeps the refusal when the hook itself fails.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (isGitCommit(e.command)) {
      const current = await read($, review)
      if (current !== null && current.phase === 'open' && !current.commits) return { deny: COMMITS_OFF }
    }

    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: COMMITS_OFF }))

  // After Claude edits a file of the checkout the Diff is recomputed: the
  // file gets its dirty mark in the pane and a ref whose lines changed its
  // stale mark. A denied or failed call changed nothing, and a file outside
  // the checkout cannot change the Diff.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const result = await next(e)
    try {
      const current = await read($, review)
      const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
      if (
        current?.info !== null &&
        current?.info !== undefined &&
        result.deny === undefined &&
        result.isError !== true &&
        isInside(path, current.info.dir)
      ) {
        await refresh($, config)
      }
    } catch (err) {
      $.ui.log(`diff-explorer: refresh after ${e.tool} failed: ${describeError(err)}`)
    }

    return result
  })

  // The refs ride along as code_ref blocks after the prompt's own words and
  // a lead-in saying they are what the request is about, the Basket's first
  // and then those typed as #path:from-to tokens, and the Basket empties
  // once the prompt has entered. A slash command's line and a hidden prompt
  // take no rewrite, so they pass untouched.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta === true) return next(e)
    const diff = await openDiff($)
    const typed = diff === null ? { refs: [], errors: [] } : refsInText(diff, e.text)
    for (const error of typed.errors) $.ui.toast(error)
    const refs = typed.refs.reduce((all, ref) => basketReducer(all, { type: 'add', ref }), await read($, basket))
    if (refs.length === 0) return next(e)
    const result = await next({ ...e, text: promptWithRefs(e.text, refs, await staleIds($, refs)) })
    if (result.drop === undefined) await update($, basket, () => [])

    return result
  })

  // While a review is open the system prompt ends with a section naming it:
  // the target, the files and how a code_ref block reads. Its text holds
  // still across turns (core/prompt/reviewSection.ts), so the prompt cache
  // survives an Edit.
  on('prompt.compose', async ($, e, next) => {
    const below = await next(e)
    const summary = summaryOf(await read($, review))
    if (summary === null) return below

    return { sections: [...below.sections, { id: SECTION_ID, text: reviewSection(summary), scope: 'session' }] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
    renderPane($, e, await read($, review), await read($, anchor), paneActions($), await read($, view)),
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

    const refs = await read($, basket)

    return renderBand($, e, refs, await staleIds($, refs), bandActions($))
  })
}
