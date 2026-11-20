import type { EngineInterface, RenderInput } from 'claude-code'

import type { Review, ReviewFile } from '../types'
import type { DiffFile, DiffLine, Hunk, HunkRow } from '../core/types.ts'
import type { Anchor } from '../core/diff/selection.ts'
import { hunksNear, layoutDiff } from '../core/diff/layout.ts'
import type { RowMeasure } from '../core/diff/layout.ts'
import { renderHunk, renderHunkHeader } from '../core/diff/patchRenderer.ts'
import { codeRows, wrapWords } from '../core/diff/wrap.ts'
import { diffCache, rowKeys } from './state.ts'

// The diff pane. Top to bottom: a head line with the auto-commit switch
// (whether Claude may commit in this checkout), a status line, then every
// file's header and its hunks, each hunk a diff Code under a header, with a
// column of line-number buttons beside the Code: the gutter, where two
// presses pick a range. Only the hunks near the scroll window are drawn; the
// rest are Boxes of the same height, so the tree keeps the rows
// core/diff/layout.ts computes and a drawing stays well under the engine's
// 100,000 characters (research note, findings 4 and 5).
//
// Long text wraps and the row count stays exact. A code line is wrapped by
// the engine, and core/diff/wrap.ts counts its rows by the same rule, so
// each gutter button is as tall as its line. A header is broken into rows
// here, one Text per row, so nothing is left to guess.
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
  /** The head row's switch: whether Claude may commit in this checkout. */
  toggleCommits(): void
}

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
  const note = f.truncated === true ? ' · too large to draw' : ''

  return `${BADGES[f.status]} ${f.path}${from}  ${counts(f)}${note}${f.dirty === true ? ' ●' : ''}`
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

const DIGITS = new WeakMap<Hunk, number>()

/** Digits of the hunk's widest line number: the width of both its gutters,
 * the pane's buttons and the engine's own numbers in the Code. */
function hunkDigits(hunk: Hunk): number {
  let digits = DIGITS.get(hunk)
  if (digits === undefined) {
    digits = Math.max(1, ...hunk.lines.map(line => String(rowNumber(line) ?? '').length))
    DIGITS.set(hunk, digits)
  }

  return digits
}

/** Cells a plain Button and the gap before it take: its label, one more. */
function beside(...labels: string[]): number {
  return labels.reduce((cells, label) => cells + label.length + 1, 0)
}

const gutterKey = (fileId: string, hunk: number, row: number) => `gutter:${fileId}:${hunk}:${row}`
/** Keys of single rows, so a scroll can put any row at the window's top: a
 * line's rows under its gutter button, a header's rows. */
const gutterRowKey = (fileId: string, hunk: number, row: number, i: number) => `gutter:${fileId}:${hunk}:${row}:${i}`
const fileRowKey = (fileId: string, i: number) => `fh:${fileId}:${i}`
const hunkRowKey = (hunkKey: string, i: number) => `hh:${hunkKey}:${i}`

const foldLabel = (folded: boolean) => (folded ? 'unfold' : 'fold')

/** The cells left for a file header's text beside its buttons. */
function fileHeaderRoom(file: DiffFile, folded: boolean, columns: number): number {
  return file.hunks.length > 0 ? columns - beside('+file', foldLabel(folded)) : columns
}

const LINE_ROWS = new WeakMap<Hunk, { columns: number; rows: number[] }>()

/** Rows of each line of a hunk at `columns` cells. The Diff's hunks stay the
 * same objects from draw to draw, so the count is kept per hunk until the
 * width changes: a scroll redraws without counting 13,000 lines again. */
function lineRows(hunk: Hunk, columns: number): number[] {
  const kept = LINE_ROWS.get(hunk)
  if (kept !== undefined && kept.columns === columns) return kept.rows
  // The pane's gutter is digits + 1 wide; the engine's own prefix in the
  // Code is digits + 3 (research note, "Wrapping in the pane").
  const digits = hunkDigits(hunk)
  const rows = hunk.lines.map(line => codeRows(line.content, columns - (digits + 1) - (digits + 3)))
  LINE_ROWS.set(hunk, { columns, rows })

  return rows
}

/** The rows each part takes at `columns` cells, by the rules the drawing follows. */
function measureAt(columns: number): RowMeasure {
  return {
    fileHeader: (file, folded) => wrapWords(fileHeader(file), fileHeaderRoom(file, folded, columns)).length,
    hunkHeader: (_, hunk) => wrapWords(renderHunkHeader(hunk), columns - beside('+hunk')).length,
    line: (hunk, index) => lineRows(hunk, columns)[index] ?? 1,
  }
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
  const columns = e.props.bodyColumns
  const head =
    info === null
      ? current.label
      : `${current.label} · ${info.headRefName ?? info.headSha.slice(0, 7)} → ${info.baseRefName ?? info.baseRef}`
  const switchLabel = `auto-commit: ${current.commits ? 'on' : 'off'}`
  const headRows = wrapWords(head, columns - beside(switchLabel))
  const statusRows = wrapWords(statusLine(current), columns)
  const cached = diffCache.current
  const diff = info !== null && cached !== null && cached.key === info.key ? cached.diff : null
  const folded = new Set(files.filter(f => f.folded).map(f => f.id))

  const sections = []
  if (diff !== null) {
    const layout = layoutDiff(diff, folded, headRows.length + statusRows.length, measureAt(columns))
    // The hunks near the window, in order, until the budget is spent.
    const sources = new Map<string, string>()
    let chars = 0
    for (const slot of hunksNear(layout, e.props.scroll)) {
      const source = renderHunk(slot.hunk, { noNewlineNote: false })
      if (chars + source.length > BUDGET) break
      chars += source.length
      sources.set(slot.key, source)
    }
    // Every row the drawing keys, by its top: the glide scrolls to these.
    rowKeys.length = 0
    for (const slot of layout.files) {
      for (let i = 0; i < slot.headerRows; i++) rowKeys.push({ top: slot.top + i, key: fileRowKey(slot.file.id, i) })
      for (const hunkSlot of slot.hunks) {
        rowKeys.push({ top: hunkSlot.top, key: hunkSlot.key })
        if (!sources.has(hunkSlot.key)) continue
        for (let i = 1; i < hunkSlot.headerRows; i++) rowKeys.push({ top: hunkSlot.top + i, key: hunkRowKey(hunkSlot.key, i) })
        let top = hunkSlot.top + hunkSlot.headerRows
        hunkSlot.lineRows.forEach((rows, row) => {
          for (let i = 0; i < rows; i++) rowKeys.push({ top: top + i, key: gutterRowKey(slot.file.id, hunkSlot.index, row, i) })
          top += rows
        })
      }
    }
    for (const slot of layout.files) {
      const file = slot.file
      const isFolded = folded.has(file.id)
      sections.push(
        <Box key={slot.key} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {wrapWords(fileHeader(file), fileHeaderRoom(file, isFolded, columns)).map((row, i) => (
                <Box key={fileRowKey(file.id, i)} height={1}>
                  <Text bold wrap="truncate-end">
                    {row}
                  </Text>
                </Box>
              ))}
            </Box>
            {file.hunks.length > 0 && (
              <Button key={`file+:${file.id}`} plain dimColor label="+file" onPress={() => actions.addFile(file)} />
            )}
            {file.hunks.length > 0 && (
              <Button
                key={`fold:${file.id}`}
                plain
                dimColor
                label={foldLabel(isFolded)}
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
            const digits = hunkDigits(hunkSlot.hunk)
            const anchoredRow =
              anchor !== null && anchor.file === file.path && anchor.hunk === hunkSlot.index ? anchor.row : -1

            return (
              <Box key={hunkSlot.key} flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                    {wrapWords(header, columns - beside('+hunk')).map((row, i) => (
                      <Box key={hunkRowKey(hunkSlot.key, i)} height={1}>
                        <Text dimColor wrap="truncate-end">
                          {row}
                        </Text>
                      </Box>
                    ))}
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
                      <Box
                        key={gutterKey(file.id, hunkSlot.index, row)}
                        flexDirection="column"
                        height={hunkSlot.lineRows[row] ?? 1}
                      >
                        <Box key={gutterRowKey(file.id, hunkSlot.index, row, 0)} height={1}>
                          <Button
                            key={`line:${file.id}:${hunkSlot.index}:${row}`}
                            plain
                            dimColor={row === anchoredRow ? undefined : true}
                            label={gutterLabel(line, digits, row === anchoredRow)}
                            onPress={() => actions.pressGutter({ file: file.path, hunk: hunkSlot.index, row })}
                          />
                        </Box>
                        {Array.from({ length: (hunkSlot.lineRows[row] ?? 1) - 1 }, (_, i) => (
                          <Box key={gutterRowKey(file.id, hunkSlot.index, row, i + 1)} height={1} />
                        ))}
                      </Box>
                    ))}
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Code format="diff" source={source} path={file.path} wrap="wrap" />
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
      <Box flexDirection="row" gap={1}>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {headRows.map((row, i) => (
            <Text key={`head:${i}`} bold wrap="truncate-end">
              {row}
            </Text>
          ))}
        </Box>
        <Button key="commits" plain label={switchLabel} onPress={() => actions.toggleCommits()} />
      </Box>
      {statusRows.map((row, i) => (
        <Text key={`status:${i}`} dimColor wrap="truncate-end">
          {row}
        </Text>
      ))}
      {current.phase === 'open' && diff === null && <Text dimColor>Loading the diff…</Text>}
      {sections}
    </Box>
  )
}
