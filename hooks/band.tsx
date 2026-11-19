import type { EngineInterface, RenderInput } from 'claude-code'

import type { CodeRef } from '../core/types.ts'
import { refLabel } from '../core/diff/refs.ts'

// The band above the prompt: the Basket as chips. A chip press scrolls the
// pane to the ref, its [x] drops it, [add selection] adds the terminal
// selection and [clear] empties the Basket. This file only draws; the
// state lives in register.tsx, which takes the presses back through
// BandActions.

export interface BandActions {
  /** Scrolls the pane to the ref's hunk. */
  show(ref: CodeRef): void
  remove(id: string): void
  addSelection(): void
  clear(): void
}

export function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, basket: CodeRef[], actions: BandActions) {
  const { Box, Text, Button } = $.ui.resolve(e)

  return (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      <Text dimColor>{basket.length === 0 ? 'refs: none' : 'refs:'}</Text>
      {basket.map(ref => (
        <Box key={`chip:${ref.id}`} flexDirection="row" gap={1}>
          <Button key={`ref:${ref.id}`} plain label={refLabel(ref)} onPress={() => actions.show(ref)} />
          <Button key={`drop:${ref.id}`} plain dimColor label="[x]" onPress={() => actions.remove(ref.id)} />
        </Box>
      ))}
      <Button key="add-selection" plain dimColor label="[add selection]" onPress={() => actions.addSelection()} />
      {basket.length > 0 && <Button key="clear-refs" plain dimColor label="[clear]" onPress={() => actions.clear()} />}
    </Box>
  )
}
