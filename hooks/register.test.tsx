import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { SAMPLE_PATCH } from '../core/testing/sample.ts'

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

const PANE = {
  plugin: 'diff-explorer',
  component: 'Pane',
  requestId: 'explore',
  props: {
    title: 'diff',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const PATCH = [
  'diff --git a/src/client.ts b/src/client.ts',
  'index 1111111..2222222 100644',
  '--- a/src/client.ts',
  '+++ b/src/client.ts',
  '@@ -40,3 +40,4 @@ export async function charge(',
  '   const res = await fetch(url, opts);',
  '-  if (!res.ok) throw new Error(res.status);',
  '+  if (!res.ok && retryable(res)) {',
  '+    return retry(() => charge(url, opts));',
  '   return res.json();',
  '',
].join('\n')

type Answer = { exitCode: number; stdout: string; stderr: string }

/** Canned git for a working tree whose diff against the base is `patch` and
 * whose `git status --porcelain -z` says `status` (empty: clean). */
function gitAnswer(argv: readonly string[], patch = PATCH, status = ''): Answer {
  const line = argv.join(' ')
  const ok = (stdout: string): Answer => ({ exitCode: 0, stdout, stderr: '' })
  if (line.includes('rev-parse --show-toplevel')) return ok('/repo\n')
  if (line.includes('rev-parse --verify --quiet origin/HEAD^{commit}')) return ok('abc\n')
  if (/merge-base \S+ HEAD$/.test(line)) return ok('base000\n')
  if (line.includes('rev-parse HEAD')) return ok('head000\n')
  if (line.includes('diff --no-color --no-ext-diff -M -U3 base000')) return ok(patch)
  if (line.includes('status --porcelain=v1 -z')) return ok(status)
  if (line.includes('diff --name-status -z -M base000')) return ok('M\0src/client.ts\0')
  if (line.includes('diff --numstat -z -M base000 -- src/client.ts')) return ok('2\t1\tsrc/client.ts\0')
  if (line.includes('restore --source=HEAD') || line.includes('clean --force')) return ok('')

  return { exitCode: 1, stdout: '', stderr: `unexpected: ${line}` }
}

const value = (a: Answer, isStdoutTruncated = false) => ({ value: { ...a, isStdoutTruncated, isStderrTruncated: false } })

/** The answer as the engine gives it past its cap: cut at `cap` bytes and flagged. */
const cut = (a: Answer, cap: number) => (a.stdout.length > cap ? value({ ...a, stdout: a.stdout.slice(0, cap) }, true) : value(a))

test('/explore . opens the working tree and the pane shows its files', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => value(gitAnswer(e.argv)))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: '.' })
  expect(ran.text).toBe('Opened working tree: 1 file, +2 −1 against origin/HEAD.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /working tree/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^M src\/client\.ts\s+\+2 −1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^@@ -40,3 \+40,4 @@/ })).toBeDefined()
    const code = await ui.find({ type: 'Code' })
    expect(code?.props).toMatchObject({ format: 'diff', path: 'src/client.ts', wrap: 'wrap' })
    expect(String(code?.props.source).startsWith('@@ -40,3 +40,4 @@ export async function charge(\n')).toBe(true)
    await ui.unmount()
  }
})

test('/explore . <base> measures from the given ref', async ($, on) => {
  mock.clock(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  const seen: string[] = []
  on('process.run', (_, e) => {
    seen.push(e.argv.join(' '))

    return value(gitAnswer(e.argv))
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: '. main' })
  expect(ran.text).toBe('Opened working tree: 1 file, +2 −1 against main.')
  expect(seen.some(line => line.includes('rev-parse --verify'))).toBe(false)
})

test('/explore reports a workspace error in the transcript and the pane', async ($, on) => {
  mock.clock(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/elsewhere' }))
  on('process.run', () => value({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' }))

  await $.session.start({ cwd: '/elsewhere', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: '412' })
  expect(ran.text).toBe('Could not open PR #412: not inside a git repository. Start Claude Code inside the repository.')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Error: not inside a git repository/ })).toBeDefined()
  await ui.unmount()
})

test('/explore without a usable target explains itself', async ($, on) => {
  mock.clock(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: 'a..b' })
  expect(ran.text).toMatch(/^Usage: \/explore/)
})

/** One file, three hunks of 600 added lines: 1,800 changed lines, over the fold threshold.
 * The counts must be right: the engine draws a hunk whose counts do not match its lines as plain code. */
const BIG_PATCH = [
  'diff --git a/big.ts b/big.ts',
  'index 1111111..2222222 100644',
  '--- a/big.ts',
  '+++ b/big.ts',
  ...[1, 1000, 2000].flatMap(start => [
    `@@ -${start},0 +${start},600 @@`,
    ...Array.from({ length: 600 }, (_, i) => `+line ${start + i}`),
  ]),
  '',
].join('\n')

async function openBig($: Engine, on: On) {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => value(gitAnswer(e.argv, BIG_PATCH)))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: '.' })
  expect(ran.text).toBe('Opened working tree: 1 file, +1800 −0 against origin/HEAD.')
}

test('a large file starts folded; unfolding draws the hunks near the window and placeholders for the rest', async ($, on) => {
  await openBig($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^M big\.ts\s+\+1800 −0$/ })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'fold:big-ts' }))?.text).toBe('unfold')
  expect(await ui.findAll({ type: 'Code' })).toHaveLength(0)

  await ui.press({ key: 'fold:big-ts' })
  expect((await ui.find({ type: 'Button', key: 'fold:big-ts' }))?.text).toBe('fold')
  // Rows: head 2, file header 1, so the first hunk starts at row 3 and each
  // hunk takes 601 rows. At offset 0 with 20 body rows only the first is near.
  let codes = await ui.findAll({ type: 'Code' })
  expect(codes).toHaveLength(1)
  expect(String(codes[0]?.props.source).startsWith('@@ -1,0 +1,600 @@')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^@@ -1000,0 \+1000,600 @@ · 600 lines/ })).toBeDefined()

  await ui.redraw({ ...PANE.props, scroll: { offset: 650, bodyRows: 20 } })
  codes = await ui.findAll({ type: 'Code' })
  expect(codes).toHaveLength(1)
  expect(String(codes[0]?.props.source).startsWith('@@ -1000,0 +1000,600 @@')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^@@ -2000,0 \+2000,600 @@ · 600 lines/ })).toBeDefined()

  await ui.press({ key: 'fold:big-ts' })
  expect(await ui.findAll({ type: 'Code' })).toHaveLength(0)
  await ui.unmount()
})

/** The repository as git answers for it, changeable between commands; `calls`
 * collects every argv line, `onCall` sees each before it is answered, and
 * while `fail` is set every git call fails with it as stderr. */
type Repo = { patch: string; status: string; calls: string[]; onCall?: (line: string) => void; fail?: string }

const sampleRepo = (): Repo => ({ patch: SAMPLE_PATCH, status: '', calls: [] })

/** Opens the sample diff of core/testing/sample.ts. `selected` is what
 * $.ui.selection answers, changeable between commands; `toasts` collects
 * what the mod toasted and `opened` what it asked $.ui.open for; `against`
 * is the base the transcript line names. A test that answers the store
 * itself passes `withStore: false`. */
async function openSample(
  $: Engine,
  on: On,
  {
    selected = {},
    toasts = [],
    repo = sampleRepo(),
    withStore = true,
    opened = [],
    against = 'origin/HEAD',
  }: {
    selected?: { text?: string }
    toasts?: string[]
    repo?: Repo
    withStore?: boolean
    opened?: Record<string, unknown>[]
    against?: string
  } = {},
) {
  mock.clock(on)
  if (withStore) mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.selection', () => ({ value: selected.text === undefined ? undefined : { text: selected.text } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push({ ...e })

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => {
    const line = e.argv.join(' ')
    repo.calls.push(line)
    repo.onCall?.(line)
    if (repo.fail !== undefined) return value({ exitCode: 128, stdout: '', stderr: repo.fail })

    return value(gitAnswer(e.argv, repo.patch, repo.status))
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: '.' })
  expect(ran.text).toBe(`Opened working tree: 4 files, +7 −5 against ${against}.`)
}

const add = ($: Engine) => $.command.run({ ...RUN, command: 'add', args: '' }).then(r => r.text)

test('/add puts the selected lines in the refs once, and explains a miss', async ($, on) => {
  const selected: { text?: string } = { text: '  if (!res.ok && retryable(res)) {\n    return retry(() => charge(url, opts));\n' }
  await openSample($, on, { selected })
  expect(await add($)).toBe('Added client.ts:41-42.')
  expect(await add($)).toBe('client.ts:41-42 is already in the refs.')
  selected.text = '  return res.json();'
  expect(await add($)).toBe(
    'The selection is in several places: README.md:2 (old), src/payments/client.ts:43. Add one with /ref path:from-to.',
  )
  selected.text = 'nothing like this'
  expect(await add($)).toBe('The selected text is not in the diff.')
  selected.text = undefined
  expect(await add($)).toBe('Select lines in the diff pane, then run /add.')
})

test('/add before /explore says so', async ($, on) => {
  mock.clock(on)
  on('ui.selection', () => ({ value: { text: 'x' } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await add($)).toBe('Nothing is open. Run /explore first.')
})

test('the pane adds a hunk, a file, and a gutter range on the second press', async ($, on) => {
  const toasts: string[] = []
  await openSample($, on, { toasts })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const gutter = async (row: number) => (await ui.find({ key: `line:src-payments-client-ts:0:${row}` }))?.text

  await ui.press({ key: 'hunk+:src-payments-client-ts:1' })
  expect(toasts).toEqual(['Added client.ts:81-83 to the refs'])
  await ui.press({ key: 'file+:src-payments-retry-ts' })
  expect(toasts[1]).toBe('Added retry.ts:1-3 to the refs')

  // The first press anchors and marks the row; the second, in either
  // order, adds the rows between and clears the mark.
  expect(await gutter(3)).toBe(' 42')
  await ui.press({ key: 'line:src-payments-client-ts:0:3' })
  expect(toasts).toHaveLength(2)
  expect(await gutter(3)).toBe('▸42')
  expect(await gutter(1)).toBe(' 41')
  await ui.press({ key: 'line:src-payments-client-ts:0:1' })
  expect(toasts[2]).toBe('Added client.ts:41-42 to the refs')
  expect(await gutter(3)).toBe(' 42')

  await ui.press({ key: 'hunk+:src-payments-client-ts:1' })
  expect(toasts[3]).toBe('client.ts:81-83 is already in the refs')
  await ui.unmount()
})

const BAND = {
  plugin: 'diff-explorer',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

/** A prompt as the person's Enter submits it. */
const PROMPT = { wait: false, origin: { kind: 'composer' } } as const

const run = ($: Engine, command: string, args = '') => $.command.run({ ...RUN, command, args }).then(r => r.text)

test('/ref adds a typed range; /refs lists the basket and clears it', async ($, on) => {
  await openSample($, on)
  expect(await run($, 'ref')).toBe('Usage: /ref path:from-to [old]')
  expect(await run($, 'ref', 'client.ts:41-43 sideways')).toBe('Usage: /ref path:from-to [old]')
  expect(await run($, 'ref', 'nope.ts:1')).toBe('No file in the diff matches nope.ts')
  expect(await run($, 'refs')).toBe('No refs. Select lines in the diff pane and run /add, or /ref path:from-to.')
  expect(await run($, 'ref', 'client.ts:41-43')).toBe('Added client.ts:41-43.')
  expect(await run($, 'ref', 'README.md:1-2 old')).toBe('Added README.md:1-2 (old).')
  expect(await run($, 'ref', 'client.ts:41-43')).toBe('client.ts:41-43 is already in the refs.')
  expect(await run($, 'refs')).toBe(
    '2 refs for the next prompt:\nr1  src/payments/client.ts:41-43  (3 lines)\nr2  README.md:1-2 (old)  (2 lines)',
  )
  expect(await run($, 'refs', 'clear')).toBe('Refs cleared.')
  expect(await run($, 'refs', 'clear')).toBe('No refs to clear.')
  expect(await run($, 'refs', 'x')).toBe('Usage: /refs [clear]')
})

test('the band shows the basket as chips; a chip scrolls, [x], [add selection] and [clear] act on it', async ($, on) => {
  const toasts: string[] = []
  const logged: string[] = []
  on('ui.log', (_, e) => {
    logged.push(e.text)

    return { value: undefined }
  })
  await openSample($, on, { selected: { text: '  return fn();' }, toasts })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^refs: none$/ })).toBeDefined()
  expect(await ui.find({ key: 'clear-refs' })).toBeUndefined()

  await run($, 'ref', 'client.ts:82')
  await ui.redraw()
  const chip = 'ref:src/payments/client.ts:new:82-82'
  expect((await ui.find({ key: chip }))?.text).toBe('client.ts:82')
  // The kit lays nothing out, so the scroll is refused; the refusal names
  // the key, which shows the press asked for the right hunk.
  await ui.press({ key: chip })
  expect(logged.some(line => line.includes('could not scroll to hunk:src-payments-client-ts:1'))).toBe(true)

  await ui.press({ key: 'add-selection' })
  expect(toasts).toContain('Added retry.ts:2.')
  expect(await ui.find({ key: 'ref:src/payments/retry.ts:new:2-2' })).toBeDefined()
  await ui.press({ key: 'drop:src/payments/client.ts:new:82-82' })
  expect(await ui.find({ key: chip })).toBeUndefined()
  expect(await ui.find({ key: 'clear-refs' })).toBeDefined()
  await ui.press({ key: 'clear-refs' })
  expect(await ui.find({ type: 'Text', text: /^refs: none$/ })).toBeDefined()
  await ui.unmount()

  // The same band on the desktop surface.
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await desktop.find({ type: 'Text', text: /^refs: none$/ })).toBeDefined()
  await run($, 'ref', 'client.ts:82')
  await desktop.redraw()
  expect((await desktop.find({ key: chip }))?.text).toBe('client.ts:82')
  await desktop.press({ key: 'drop:src/payments/client.ts:new:82-82' })
  expect(await desktop.find({ key: chip })).toBeUndefined()
  await desktop.unmount()
})

test('a prompt carries the basket and the typed refs as code_ref blocks, then the basket is empty', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await openSample($, on)
  await run($, 'ref', 'client.ts:41-43')
  const sent = await $.prompt.submit({ ...PROMPT, text: 'why is this retry safe? also #retry.ts:1-2' })
  expect(sent.drop).toBeUndefined()
  expect(sent.text).toBe(
    [
      'why is this retry safe? also #retry.ts:1-2',
      '',
      'Selected in the diff pane, the lines this request is about:',
      '',
      '<code_ref id="r1" file="src/payments/client.ts" side="new" lines="41-43">',
      '41 +|   if (!res.ok && retryable(res)) {',
      '42 +|     return retry(() => charge(url, opts));',
      '43  |   return res.json();',
      '</code_ref>',
      '',
      '<code_ref id="r2" file="src/payments/retry.ts" side="new" lines="1-2">',
      '1 +| export function retry<T>(fn: () => Promise<T>): Promise<T> {',
      '2 +|   return fn();',
      '</code_ref>',
    ].join('\n'),
  )
  expect(await run($, 'refs')).toBe('No refs. Select lines in the diff pane and run /add, or /ref path:from-to.')
  expect((await $.prompt.submit({ ...PROMPT, text: 'and now?' })).text).toBe('and now?')
})

const ENGINE_SECTIONS = [{ id: 'intro', text: 'You are Claude.', scope: 'shared' }] as const

/** A system prompt render as the engine raises it. */
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as const

test('the system prompt ends with a review section while a review is open', async ($, on) => {
  on('prompt.compose', () => ({ sections: ENGINE_SECTIONS }))
  await openSample($, on)
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.map(s => s.id)).toEqual(['intro', 'diff-explorer:review'])
  const section = composed.sections[1]
  expect(section?.scope).toBe('session')
  expect(section?.text).toContain('The person is reviewing working tree (head000 against origin/HEAD) in the diff-explorer pane')
  expect(section?.text).toContain('`git diff base000`')
  expect(section?.text).toContain(
    'Files in the diff:\n- deleted LICENSE\n- modified README.md\n- modified src/payments/client.ts\n- added src/payments/retry.ts',
  )
})

test('the system prompt is left alone while nothing is open', async ($, on) => {
  on('prompt.compose', () => ({ sections: ENGINE_SECTIONS }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect((await $.prompt.compose(COMPOSE)).sections).toEqual(ENGINE_SECTIONS)
})

/** The Edit tool's own record, as the kit's bottom answers an Edit the test raises. */
const edited = (e: { file_path: string; old_string: string; new_string: string }) => ({
  result: {
    filePath: e.file_path,
    oldString: e.old_string,
    newString: e.new_string,
    originalFile: null,
    structuredPatch: [],
    userModified: false,
    replaceAll: false,
  },
})

test('an Edit in the checkout refreshes the diff: a dirty mark on the file, a stale mark on its chip and in the prompt', async ($, on) => {
  const repo = sampleRepo()
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Edit' }, (_, e) => edited(e))
  await openSample($, on, { repo })
  await run($, 'ref', 'client.ts:41-42')
  await run($, 'ref', 'retry.ts:1-3')

  // An edit elsewhere leaves the review alone, whatever git would now say.
  repo.status = ' M src/payments/client.ts\0'
  await $.tool.call({ tool: 'Edit', file_path: '/elsewhere/notes.md', old_string: 'a', new_string: 'b' })
  let pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^M src\/payments\/client\.ts\s+\+3 −1$/ })).toBeDefined()
  await pane.unmount()

  // Claude changes line 41 of client.ts: the file is dirty and the ref's lines are gone.
  repo.patch = SAMPLE_PATCH.replace('+  if (!res.ok && retryable(res)) {', '+  if (!res.ok && canRetry(res)) {')
  const called = await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/src/payments/client.ts',
    old_string: 'retryable',
    new_string: 'canRetry',
  })
  expect(called.deny).toBeUndefined()
  pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ type: 'Text', text: /^M src\/payments\/client\.ts\s+\+3 −1 ●$/ })).toBeDefined()
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ key: 'ref:src/payments/client.ts:new:41-42' }))?.text).toBe('client.ts:41-42 (stale)')
  expect((await band.find({ key: 'ref:src/payments/retry.ts:new:1-3' }))?.text).toBe('retry.ts:1-3')
  await band.unmount()
  const sent = await $.prompt.submit({ ...PROMPT, text: 'still fine?' })
  expect(sent.text).toContain('<code_ref id="r1" file="src/payments/client.ts" side="new" lines="41-42" stale="true">')
  expect(sent.text).toContain('<code_ref id="r2" file="src/payments/retry.ts" side="new" lines="1-3">')
})

test('/revert restores a dirty file once the person confirms, and explains every other case', async ($, on) => {
  const repo = sampleRepo()
  repo.status = ' M src/payments/client.ts\0'
  // The restore leaves the tree clean, as git would.
  repo.onCall = line => {
    if (line.includes('restore --source=HEAD')) repo.status = ''
  }
  const asked: string[] = []
  let answer = 'Keep'
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)

    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  await openSample($, on, { repo })
  expect(await run($, 'revert')).toBe('Usage: /revert <path>')
  expect(await run($, 'revert', 'nope.ts')).toBe('nope.ts is not in the diff.')
  expect(await run($, 'revert', 'README.md')).toBe('README.md has no uncommitted changes.')
  expect(await run($, 'revert', 'src/payments/client.ts')).toBe('Kept src/payments/client.ts.')
  expect(asked).toEqual(['Revert src/payments/client.ts? Its uncommitted changes are lost; a file not yet committed is deleted.'])
  answer = 'Revert'
  expect(await run($, 'revert', 'src/payments/client.ts')).toBe('Reverted src/payments/client.ts.')
  expect(repo.calls.some(line => line.endsWith('restore --source=HEAD --staged --worktree -- src/payments/client.ts'))).toBe(true)
  expect(await run($, 'revert', 'src/payments/client.ts')).toBe('src/payments/client.ts has no uncommitted changes.')
})

test('/revert before /explore says so', async ($, on) => {
  mock.clock(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await run($, 'revert', 'x.ts')).toBe('Nothing is open. Run /explore first.')
})

test('/explore with no argument reopens the last target of this repository, kept in the store', async ($, on) => {
  const stored = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)

    return { value: undefined }
  })
  await openSample($, on, { withStore: false })
  expect(stored.get('recent')).toEqual({ '/repo': { target: { kind: 'worktree' }, baseRef: null, commits: true } })
  expect(await run($, 'explore')).toBe('Opened working tree: 4 files, +7 −5 against origin/HEAD.')
})

test('/explore with no argument and nothing remembered here says so', async ($, on) => {
  mock.clock(on)
  mock.store(on, { recent: { '/work/pay': { target: { kind: 'pr', number: 412 }, baseRef: null } } })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/elsewhere' }))
  await $.session.start({ cwd: '/elsewhere', surface: 'terminal', isInteractive: true })
  expect(await run($, 'explore')).toBe('Nothing to reopen here. Usage: /explore <number | url | owner/repo#n | branch | .> [base ref]')
})

test('a session that starts outside the checkout drops the review it kept', async ($, on) => {
  await openSample($, on)
  await run($, 'ref', 'client.ts:41-42')
  await $.session.start({ cwd: '/elsewhere', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Nothing open/ })).toBeDefined()
  await ui.unmount()
  expect(await run($, 'refs')).toBe('No refs. Select lines in the diff pane and run /add, or /ref path:from-to.')
})

/** A Bash run as the kit's bottom answers one the test raises. */
const ran = () => ({ result: { stdout: '', stderr: '', interrupted: false } })

test('the head row switch turns commits off and on: the section changes and a git commit is refused while off', async ($, on) => {
  const stored = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)

    return { value: undefined }
  })
  on('prompt.compose', () => ({ sections: ENGINE_SECTIONS }))
  on('tool.call', { tool: 'Bash' }, () => ran())
  await openSample($, on, { withStore: false })
  const commit = () => $.tool.call({ tool: 'Bash', command: 'git commit -m x' })
  const section = async () => (await $.prompt.compose(COMPOSE)).sections[1]?.text ?? ''

  // The person's own tree starts with commits on.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'commits' }))?.text).toBe('auto-commit: on')
  expect(await section()).toContain('Commits in it are allowed')
  expect((await commit()).deny).toBeUndefined()

  await ui.press({ key: 'commits' })
  expect((await ui.find({ key: 'commits' }))?.text).toBe('auto-commit: off')
  expect(await section()).toContain('Do not commit in it: the auto-commit switch in the diff pane is off')
  expect((await commit()).deny).toBe('Commits are off for this review: the "auto-commit" switch in the diff pane turns them on.')
  expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).deny).toBeUndefined()
  expect(stored.get('recent')).toEqual({ '/repo': { target: { kind: 'worktree' }, baseRef: null, commits: false } })

  // The setting comes back with the repository.
  expect(await run($, 'explore', '.')).toBe('Opened working tree: 4 files, +7 −5 against origin/HEAD.')
  await ui.redraw()
  expect((await ui.find({ key: 'commits' }))?.text).toBe('auto-commit: off')
  await ui.press({ key: 'commits' })
  expect((await commit()).deny).toBeUndefined()
  await ui.unmount()
})

test(
  'the options set the base ref of a local target, the fold threshold and the inline rows',
  { options: { baseRef: 'develop', foldLines: 2, inlineRows: 12 } },
  async ($, on) => {
    const repo = sampleRepo()
    const opened: Record<string, unknown>[] = []
    await openSample($, on, { repo, opened, against: 'develop' })
    expect(repo.calls.some(line => line.endsWith('merge-base develop HEAD'))).toBe(true)
    expect(repo.calls.some(line => line.includes('rev-parse --verify'))).toBe(false)
    expect(opened[0]).toMatchObject({ id: 'explore', title: 'diff', rows: 12 })

    // Over two changed lines a file starts folded: LICENSE, with two, does not.
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Button', key: 'fold:src-payments-client-ts' }))?.text).toBe('unfold')
    expect((await ui.find({ type: 'Button', key: 'fold:src-payments-retry-ts' }))?.text).toBe('unfold')
    expect((await ui.find({ type: 'Button', key: 'fold:LICENSE' }))?.text).toBe('fold')
    await ui.unmount()

    // A base ref typed after the target wins over the configured one.
    expect(await run($, 'explore', '. main')).toBe('Opened working tree: 4 files, +7 −5 against main.')
  },
)

test('a refresh that fails says so in a toast, with the hint, and in the pane', async ($, on) => {
  const repo = sampleRepo()
  const toasts: string[] = []
  on('tool.call', { tool: 'Edit' }, (_, e) => edited(e))
  await openSample($, on, { repo, toasts })
  repo.fail = 'fatal: not a git repository (or any of the parent directories): .git'
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/payments/client.ts', old_string: 'a', new_string: 'b' })
  expect(toasts).toContain('Could not refresh the diff: not inside a git repository. Start Claude Code inside the repository.')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Error: not inside a git repository/ })).toBeDefined()
  await ui.unmount()
})

test('a patch the engine cuts at its cap is fetched per file; a file still cut says so in the pane', async ($, on) => {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => cut(gitAnswer(e.argv), 100))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(await run($, 'explore', '.')).toBe('Opened working tree: 1 file, +2 −1 against origin/HEAD.')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^M src\/client\.ts\s+\+2 −1 · too large to draw$/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Code' })).toHaveLength(0)
  expect(await ui.find({ key: 'fold:src-client-ts' })).toBeUndefined()
  await ui.unmount()
})

test('a narrow pane wraps long lines: each gutter button is as tall as its line, headers break into rows', async ($, on) => {
  await openSample($, on)
  // 30 columns: the client.ts hunk's numbers have 2 digits, so its gutter is
  // 3 cells, the engine's prefix 5 and the code 22.
  const narrow = { ...PANE.props, bodyColumns: 30 }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: narrow })
    expect((await ui.find({ type: 'Code' }))?.props.wrap).toBe('wrap')
    // '    return retry(() => charge(url, opts));' is 42 cells: two rows.
    const height = async (row: number) => (await ui.find({ key: `gutter:src-payments-client-ts:0:${row}` }))?.props.height
    expect(await height(0)).toBe(2)
    expect(await height(3)).toBe(2)
    expect(await height(4)).toBe(1)
    // The head row breaks beside the switch, the file header beside its buttons.
    expect(await ui.find({ type: 'Text', text: /^working tree ·$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^head000 →$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^src\/payments\/client$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\.ts {2}\+3 −1$/ })).toBeDefined()
    await ui.unmount()
  }
})
