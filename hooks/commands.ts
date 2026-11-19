import type { EngineInterface } from 'claude-code'

import type { CodeRef, Diff } from '../core/types.ts'
import { locateText } from '../core/diff/locate.ts'
import { refLabel, refName } from '../core/diff/refs.ts'
import { captureRows } from '../core/diff/selection.ts'

// The slash commands' words: what each answers in the transcript. The state
// stays in register.tsx, where the validator reads every update's atom, so a
// command takes the open Diff and a way to change the Basket and gives back
// its text.

/** What putting a ref in the Basket came to. */
export type Outcome = 'added' | 'present'

export const NOTHING_OPEN = 'Nothing is open. Run /explore first.'

export function added(ref: CodeRef, outcome: Outcome): string {
  return outcome === 'added' ? `Added ${refLabel(ref)}.` : `${refLabel(ref)} is already in the refs.`
}

/** `/add`: the terminal selection, found in the Diff by its text. */
export async function runAdd(
  $: EngineInterface,
  diff: Diff | null,
  add: (ref: CodeRef) => Promise<Outcome>,
): Promise<string> {
  if (diff === null) return NOTHING_OPEN
  const selected = await $.ui.selection()
  if (selected === undefined || selected.text.trim() === '') return 'Select lines in the diff pane, then run /add.'
  const found = locateText(diff, selected.text)
  if (found.kind === 'ambiguous') {
    const places = found.candidates
      .map(c => captureRows(c.file, c.hunk, c.from, c.to))
      .filter(r => r !== undefined)
      .map(refName)

    return `The selection is in several places: ${places.join(', ')}. Add one with /ref path:from-to.`
  }
  const ref = found.kind === 'located' ? captureRows(found.at.file, found.at.hunk, found.at.from, found.at.to) : undefined
  if (ref === undefined) return 'The selected text is not in the diff.'

  return added(ref, await add(ref))
}
