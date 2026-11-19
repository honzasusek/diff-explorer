import type { EngineInterface } from 'claude-code'

import type { CodeRef, Diff } from '../core/types.ts'
import { locateText } from '../core/diff/locate.ts'
import { parseRefToken, refLabel, refName } from '../core/diff/refs.ts'
import { captureRows } from '../core/diff/selection.ts'
import { explainError } from '../core/workspace/errors.ts'

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

const REF_USAGE = 'Usage: /ref path:from-to [old]'

/** `/ref path:from-to [old]`: a typed range, on the new Side unless `old` follows. */
export async function runRef(args: string, diff: Diff | null, add: (ref: CodeRef) => Promise<Outcome>): Promise<string> {
  if (diff === null) return NOTHING_OPEN
  const [token = '', side, ...rest] = args.trim().split(/\s+/)
  if (token === '' || rest.length > 0 || (side !== undefined && side !== 'old' && side !== 'new')) return REF_USAGE
  const parsed = parseRefToken(token, diff, side ?? 'new')
  if (parsed.ref === undefined) return parsed.error

  return added(parsed.ref, await add(parsed.ref))
}

export interface RevertPorts {
  /** Asks the person; true when they chose to revert. */
  confirm(path: string): Promise<boolean>
  /** Restores the file and refreshes the Diff. */
  revert(path: string): Promise<void>
}

/** `/revert path`: restores a Dirty File to the committed version once the
 * person has confirmed; the path is the one the pane shows. */
export async function runRevert(
  args: string,
  files: readonly { path: string; dirty: boolean }[] | null,
  ports: RevertPorts,
): Promise<string> {
  if (files === null) return NOTHING_OPEN
  const path = args.trim()
  if (path === '') return 'Usage: /revert <path>'
  const file = files.find(f => f.path === path)
  if (file === undefined) return `${path} is not in the diff.`
  if (!file.dirty) return `${path} has no uncommitted changes.`
  if (!(await ports.confirm(path))) return `Kept ${path}.`
  try {
    await ports.revert(path)
  } catch (err) {
    return `Could not revert ${path}: ${explainError(err)}`
  }

  return `Reverted ${path}.`
}

export const NO_REFS = 'No refs. Select lines in the diff pane and run /add, or /ref path:from-to.'

/** `/refs`: the Basket, one line per ref; `/refs clear` empties it. */
export async function runRefs(args: string, basket: CodeRef[], clear: () => Promise<void>): Promise<string> {
  const what = args.trim()
  if (what === 'clear') {
    if (basket.length === 0) return 'No refs to clear.'
    await clear()

    return 'Refs cleared.'
  }
  if (what !== '') return 'Usage: /refs [clear]'
  if (basket.length === 0) return NO_REFS
  const rows = basket.map((ref, i) => `r${i + 1}  ${refName(ref)}  (${ref.lines.length} ${ref.lines.length === 1 ? 'line' : 'lines'})`)

  return [`${basket.length === 1 ? '1 ref' : `${basket.length} refs`} for the next prompt:`, ...rows].join('\n')
}
