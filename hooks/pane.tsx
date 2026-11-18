import type { EngineInterface, RenderInput } from 'claude-code'

import type { Review, ReviewFile } from '../types'
import type { DiffFile } from '../core/types.ts'
import { fileKey, hunksNear, layoutDiff } from '../core/diff/layout.ts'
import { renderHunk, renderHunkHeader } from '../core/diff/patchRenderer.ts'
import { diffCache } from './state.ts'

// The diff pane. Top to bottom: a head line, a status line, one list row per
// file (a press scrolls to the file), then every file's header row and its
// hunks, each hunk a diff Code under a header row. Only the hunks near the
// scroll window are drawn; the rest are Boxes of the same height, so the
// tree keeps the rows core/diff/layout.ts computes and a drawing stays well
// under the engine's 100,000 characters (research note, findings 4 and 5).
//
// This file only draws. The state lives in register.tsx, which hands the
// Review in and takes the presses back through PaneActions.

export interface PaneActions {
  /** Brings the element with this key to the top of the pane. */
  scrollTo(key: string): void
  /** Hides or shows a file's hunks. */
  toggleFold(fileId: string): void
}

/** Rows above the file list: the head line and the status line. */
const HEAD_ROWS = 2
/** Hunk text one drawing may hold. The engine cuts a drawing at 100,000
 * characters; the rest of the tree is small, so this leaves room. */
const BUDGET = 80_000

const BADGES: Record<ReviewFile['status'], string> = {
  added: 'A',
  deleted: 'D',
  modified: 'M',
  renamed: 'R',
  copied: 'C',
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function counts(f: { binary: boolean; additions: number; deletions: number }): string {
  return f.binary ? 'binary' : `+${f.additions} −${f.deletions}`
}

function listLabel(f: ReviewFile): string {
  return `${BADGES[f.status]} ${f.path}  ${counts(f)}${f.dirty ? ' ●' : ''}${f.folded ? ' (folded)' : ''}`
}

function fileHeader(f: DiffFile): string {
  const from = f.oldPath !== null && f.oldPath !== f.path ? ` ← ${f.oldPath}` : ''

  return `${BADGES[f.status]} ${f.path}${from}  ${counts(f)}${f.dirty === true ? ' ●' : ''}`
}

function statusLine(current: Review): string {
  if (current.phase === 'opening') return 'Opening…'
  if (current.phase === 'failed') return `Error: ${current.error ?? 'unknown'}`
  const summary = `${plural((current.files ?? []).length, 'file')} · +${current.additions} −${current.deletions}`
  const title = current.info?.title

  return title ? `${title} · ${summary}` : summary
}

export function renderPane($: EngineInterface, e: RenderInput<'Pane'>, current: Review | null, actions: PaneActions) {
  const { Box, Text, Button, Code } = $.ui.resolve(e)

  if (current === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Nothing open. Run /explore {'<pr number>'}.</Text>
      </Box>
    )
  }

  const info = current.info
  const files = current.files ?? []
  const head =
    info === null
      ? current.label
      : `${current.label} · ${info.headRefName ?? info.headSha.slice(0, 7)} → ${info.baseRefName ?? info.baseRef}`
  const cached = diffCache.current
  const diff = info !== null && cached !== null && cached.key === info.key ? cached.diff : null
  const folded = new Set(files.filter(f => f.folded).map(f => f.id))

  const scrollTo = (key: string) => () => actions.scrollTo(key)
  const toggleFold = (id: string) => () => actions.toggleFold(id)

  const sections = []
  if (diff !== null) {
    const layout = layoutDiff(diff, folded, HEAD_ROWS)
    // The hunks near the window, in order, until the budget is spent.
    const sources = new Map<string, string>()
    let chars = 0
    for (const slot of hunksNear(layout, e.props.scroll)) {
      const source = renderHunk(slot.hunk)
      if (chars + source.length > BUDGET) break
      chars += source.length
      sources.set(slot.key, source)
    }
    for (const slot of layout.files) {
      const file = slot.file
      sections.push(
        <Box key={slot.key} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text bold wrap="truncate-end">
                {fileHeader(file)}
              </Text>
            </Box>
            {file.hunks.length > 0 && (
              <Button
                key={`fold:${file.id}`}
                plain
                dimColor
                label={folded.has(file.id) ? 'unfold' : 'fold'}
                onPress={toggleFold(file.id)}
              />
            )}
          </Box>
          {slot.hunks.map(hunkSlot => {
            const header = renderHunkHeader(hunkSlot.hunk)
            const source = sources.get(hunkSlot.key)
            if (source === undefined) {
              return (
                <Box key={hunkSlot.key} flexDirection="column" height={hunkSlot.rows}>
                  <Text dimColor wrap="truncate-end">
                    {header} · {plural(hunkSlot.hunk.lines.length, 'line')}
                  </Text>
                </Box>
              )
            }

            return (
              <Box key={hunkSlot.key} flexDirection="column">
                <Text dimColor wrap="truncate-end">
                  {header}
                </Text>
                <Code format="diff" source={source} path={file.path} wrap="truncate-end" />
              </Box>
            )
          })}
        </Box>,
      )
    }
  }

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        {head}
      </Text>
      <Text dimColor wrap="truncate-end">
        {statusLine(current)}
      </Text>
      {files.map(f => (
        <Button key={`list:${f.id}`} plain label={listLabel(f)} onPress={scrollTo(fileKey(f.id))} />
      ))}
      {current.phase === 'open' && diff === null && <Text dimColor>Loading the diff…</Text>}
      {sections}
    </Box>
  )
}
