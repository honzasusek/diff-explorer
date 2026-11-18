import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Review } from '../types'
import { describeTarget, parseTarget } from '../core/workspace/target.ts'

const PANE = 'diff'

// Bump the tag when Review's fields change: a reload keeps what the previous
// version stored, and a different tag reads as the initial value instead.
const review = atom({ plugin: 'diff-explorer', key: 'review' } as const, null, {
  shape: 'review-1',
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'explore',
      description: 'Open a pull request or branch diff in a pane beside the chat',
      argumentHint: '[number | url | owner/repo#n | branch | .]',
    })

    return next(e)
  })

  on('command.run', { command: 'explore' }, async ($, e) => {
    const target = parseTarget(e.args)
    if (!target) {
      return { text: 'Usage: /explore <number | url | owner/repo#n | branch | .>' }
    }
    const next: Review = {
      target,
      label: describeTarget(target),
      openedAt: await $.clock.now(),
    }
    await update($, review, () => next)
    const opened = await $.ui.open({ id: PANE, title: 'diff' })

    return {
      text: opened.isPlaced
        ? `Opened ${next.label}.`
        : `Opened ${next.label}; the pane waits for a wider terminal (${opened.reason}).`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, review)

    return (
      <Box flexDirection="column">
        {current === null ? (
          <Text dimColor>Nothing open. Run /explore {'<pr number>'}.</Text>
        ) : (
          <Text>{current.label}: the diff is not drawn yet.</Text>
        )}
        <Text dimColor>
          {e.props.placement}, {e.props.bodyColumns} columns, {e.props.scroll.bodyRows} rows
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, review)
    if (e.props.hasSurvey || current === null) {
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
