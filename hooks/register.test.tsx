import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

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

test('/explore . opens the working tree and the pane lists its files', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'explore' } }))
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
    expect(await ui.find({ type: 'Button', text: /M src\/client\.ts\s+\+2 −1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^@@ -40,3 \+40,4 @@/ })).toBeDefined()
    const code = await ui.find({ type: 'Code' })
    expect(code?.props).toMatchObject({ format: 'diff', path: 'src/client.ts', wrap: 'truncate-end' })
    expect(String(code?.props.source).startsWith('@@ -40,3 +40,4 @@ export async function charge(\n')).toBe(true)
    await ui.unmount()
  }
})

test('/explore . <base> measures from the given ref', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'explore' } }))
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
  on('command.register', () => ({ value: { command: 'explore' } }))
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
  on('command.register', () => ({ value: { command: 'explore' } }))
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
  on('command.register', () => ({ value: { command: 'explore' } }))
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
  expect(await ui.find({ type: 'Button', text: /M big\.ts\s+\+1800 −0 \(folded\)/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Code' })).toHaveLength(0)

  await ui.press({ key: 'fold:big-ts' })
  expect(await ui.find({ type: 'Button', text: /\(folded\)/ })).toBeUndefined()
  // Rows: head 2, list 1, file header 1, so the first hunk starts at row 4 and
  // each hunk takes 601 rows. At offset 0 with 20 body rows only the first is near.
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

test('a file list row asks the engine to scroll to that file', async ($, on) => {
  // The kit lays nothing out, so the scroll is refused there; the refusal
  // names the key, which shows the press reached the right call.
  const logged: string[] = []
  on('ui.log', (_, e) => {
    logged.push(e.text)

    return { value: undefined }
  })
  await openBig($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'list:big-ts' })
  expect(logged.some(line => line.includes('file:big-ts'))).toBe(true)
  await ui.unmount()
})
