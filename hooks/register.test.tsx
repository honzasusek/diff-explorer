import { expect, mock, test } from 'claude-code/testing'

const RUN = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

const PANE = {
  plugin: 'diff-explorer',
  component: 'Pane',
  requestId: 'diff',
  props: {
    title: 'diff',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('/explore opens the pane and the pane names the target', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'explore' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: '412' })
  expect(ran.text).toBe('Opened PR #412.')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /PR #412/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/explore without a usable target explains itself', async ($, on) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('command.register', () => ({ value: { command: 'explore' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run({ ...RUN, command: 'explore', args: 'not a ref' })
  expect(ran.text).toMatch(/^Usage: \/explore/)
})
