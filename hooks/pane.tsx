import type { EngineInterface, RenderInput } from 'claude-code'

import type { Review, ReviewFile } from '../types'
import type { DiffFile, DiffLine, HunkRow } from '../core/types.ts'
import type { Anchor } from '../core/diff/selection.ts'
import { hunksNear, layoutDiff } from '../core/diff/layout.ts'
import { renderHunk, renderHunkHeader } from '../core/diff/patchRenderer.ts'
import { diffCache } from './state.ts'

// The diff pane. Top to bottom: a head line, a status line, then every file's
// header row and its hunks, each hunk a diff Code under a header row, with a
// column of line-number buttons beside the Code: the gutter, where two
// presses pick a range. Only the hunks near the scroll window are drawn; the
// rest are Boxes of the same height, so the tree keeps the rows
// core/diff/layout.ts computes and a drawing stays well under the engine's
// 100,000 characters (research note, findings 4 and 5).
//
// This file only draws. The state lives in register.tsx, which hands the
// Review and the gutter anchor in and takes the presses back through
// PaneActions.

export interface PaneActions {
  /** Hides or shows a file's hunks. */
  toggleFold(fileId: string): void
  /** A press on a line number: the first anchors, the second adds the range. */
  pressGutter(row: HunkRow): void
  addHunk(file: DiffFile, hunkIndex: number): void
  addFile(file: DiffFile): void
}

/** Rows above the first file: the head line and the status line. */
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

/** The number a gutter row shows: the old one on a deleted line, else the new one. */
function rowNumber(line: DiffLine): number | null {
  return line.type === 'del' ? line.oldNo : line.newNo
}

/** The gutter label, one row: a mark on the anchored row, then the number
 * right-aligned to the hunk's widest. `▸42` and ` 41`. */
function gutterLabel(line: DiffLine, digits: number, anchored: boolean): string {
  return `${anchored ? '▸' : ' '}${String(rowNumber(line) ?? '').padStart(digits)}`
}

export function renderPane(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  current: Review | null,
  anchor: Anchor,
  actions: PaneActions,
) {
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

  const sections = []
  if (diff !== null) {
    const layout = layoutDiff(diff, folded, HEAD_ROWS)
    // The hunks near the window, in order, until the budget is spent.
    const sources = new Map<string, string>()
    let chars = 0
    for (const slot of hunksNear(layout, e.props.scroll)) {
      const source = renderHunk(slot.hunk, { noNewlineNote: false })
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
              <Button key={`file+:${file.id}`} plain dimColor label="+file" onPress={() => actions.addFile(file)} />
            )}
            {file.hunks.length > 0 && (
              <Button
                key={`fold:${file.id}`}
                plain
                dimColor
                label={folded.has(file.id) ? 'unfold' : 'fold'}
                onPress={() => actions.toggleFold(file.id)}
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
            const lines = hunkSlot.hunk.lines
            const digits = Math.max(1, ...lines.map(line => String(rowNumber(line) ?? '').length))
            const anchoredRow =
              anchor !== null && anchor.file === file.path && anchor.hunk === hunkSlot.index ? anchor.row : -1

            return (
              <Box key={hunkSlot.key} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text dimColor wrap="truncate-end">
                      {header}
                    </Text>
                  </Box>
                  <Button
                    key={`hunk+:${file.id}:${hunkSlot.index}`}
                    plain
                    dimColor
                    label="+hunk"
                    onPress={() => actions.addHunk(file, hunkSlot.index)}
                  />
                </Box>
                <Box flexDirection="row">
                  <Box flexDirection="column" flexShrink={0}>
                    {lines.map((line, row) => (
                      <Button
                        key={`line:${file.id}:${hunkSlot.index}:${row}`}
                        plain
                        dimColor={row === anchoredRow ? undefined : true}
                        label={gutterLabel(line, digits, row === anchoredRow)}
                        onPress={() => actions.pressGutter({ file: file.path, hunk: hunkSlot.index, row })}
                      />
                    ))}
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Code format="diff" source={source} path={file.path} wrap="truncate-end" />
                  </Box>
                </Box>
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
      {current.phase === 'open' && diff === null && <Text dimColor>Loading the diff…</Text>}
      {sections}
    </Box>
  )
}
