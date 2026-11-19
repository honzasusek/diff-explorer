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

/** Canned git for a clean working tree whose diff against the base is `patch`. */
function gitAnswer(argv: readonly string[], patch = PATCH): Answer {
  const line = argv.join(' ')
  const ok = (stdout: string): Answer => ({ exitCode: 0, stdout, stderr: '' })
  if (line.includes('rev-parse --show-toplevel')) return ok('/repo\n')
  if (line.includes('rev-parse --verify --quiet origin/HEAD^{commit}')) return ok('abc\n')
  if (line.includes('merge-base origin/HEAD HEAD')) return ok('base000\n')
  if (line.includes('merge-base main HEAD')) return ok('base000\n')
  if (line.includes('rev-parse HEAD')) return ok('head000\n')
  if (line.includes('diff --no-color --no-ext-diff -M -U3 base000')) return ok(patch)
  if (line.includes('status --porcelain=v1 -z')) return ok('')

  return { exitCode: 1, stdout: '', stderr: `unexpected: ${line}` }
}

const value = (a: Answer) => ({ value: { ...a, isStdoutTruncated: false, isStderrTruncated: false } })

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
    expect(code?.props).toMatchObject({ format: 'diff', path: 'src/client.ts', wrap: 'truncate-end' })
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
  expect(ran.text).toBe('Could not open PR #412: not inside a git repository')

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

/** Opens the sample diff of core/testing/sample.ts. `selected` is what
 * $.ui.selection answers, changeable between commands; `toasts` collects
 * what the mod toasted. */
async function openSample($: Engine, on: On, selected: { text?: string } = {}, toasts: string[] = []) {
  mock.clock(on)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.selection', () => ({ value: selected.text === undefined ? undefined : { text: selected.text } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_, e) => value(gitAnswer(e.argv, SAMPLE_PATCH)))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: '.' })
  expect(ran.text).toBe('Opened working tree: 4 files, +7 −5 against origin/HEAD.')
}

const add = ($: Engine) => $.command.run({ ...RUN, command: 'add', args: '' }).then(r => r.text)

test('/add puts the selected lines in the refs once, and explains a miss', async ($, on) => {
  const selected: { text?: string } = { text: '  if (!res.ok && retryable(res)) {\n    return retry(() => charge(url, opts));\n' }
  await openSample($, on, selected)
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
  await openSample($, on, {}, toasts)
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
