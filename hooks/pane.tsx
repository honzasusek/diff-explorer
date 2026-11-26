import type { EngineInterface, RenderInput } from 'claude-code'

import type { DiffView, Review, ReviewFile } from '../types'
import type { DiffFile, DiffLine, Hunk, HunkRow, Side } from '../core/types.ts'
import type { Anchor } from '../core/diff/selection.ts'
import { hunksNear, layoutDiff } from '../core/diff/layout.ts'
import type { RowMeasure } from '../core/diff/layout.ts'
import { renderHunk, renderHunkHeader } from '../core/diff/patchRenderer.ts'
import { sideDigits, sideNumber, sideSource, splitHunk } from '../core/diff/split.ts'
import type { SplitBlock } from '../core/diff/split.ts'
import { codeRows, textWidth, wrapWords } from '../core/diff/wrap.ts'
import { diffCache } from './state.ts'

// The diff pane. Top to bottom: a head line with two switches, the
// side-by-side view and auto-commit (whether Claude may commit in this
// checkout), a status line, then every file's header and its hunks, each
// hunk a diff Code under a header, with a column of line-number buttons
// beside the Code: the gutter, where two presses pick a range. Side by side,
// a hunk is drawn as blocks (core/diff/split.ts), each side of a block its
// own Code with its own gutter. Only the hunks near the scroll window are drawn; the
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
  /** The head row's other switch: unified or side by side. */
  toggleView(): void
  /** The desktop pane's pick mode: draw this hunk (`src-a-ts:2`) a line per row, or none. */
  pick(key: string | null): void
}

/** Hunk text one drawing may hold. The engine cuts a drawing at 100,000
 * characters; the rest of the tree is small, so this leaves room. */
export const BUDGET = 80_000

/** Cells the head's text keeps beside the switches before they move under it. */
const HEAD_ROOM = 20

/** The sticky row's text: the head cut to fit `room` cells, then the fold
 * count after it. The head is padded so the two fill `room` exactly, because the
 * row is painted over the diff, and a cell it leaves out would let the line
 * beneath show through. `stickyRow('working tree · main', '1/3 folded', 40)`
 * gives head `'working tree · main           '` and label `'1/3 folded'`. */
export function stickyRow(head: string, label: string, room: number): { head: string; label: string } {
  const space = Math.max(0, room - label.length - 1)
  const cut = space === 0 ? '' : (wrapWords(head, space)[0] ?? '')
  const shown = textWidth(cut) > space ? '' : cut

  return { head: shown + ' '.repeat(Math.max(0, room - label.length - textWidth(shown))), label }
}

/** `text` with spaces after it to fill `width` cells, so a row laid over the
 * diff covers it. */
function fill(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - textWidth(text)))
}

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

export function fileHeader(f: DiffFile): string {
  const from = f.oldPath !== null && f.oldPath !== f.path ? ` ← ${f.oldPath}` : ''
  const note = f.truncated === true ? ' · too large to draw' : ''

  return `${BADGES[f.status]} ${f.path}${from}  ${counts(f)}${note}${f.dirty === true ? ' ●' : ''}`
}

/** The head's text: the target, then its head and base, as
 * `#412 · fix-retry → main`. */
export function headLine(current: Review): string {
  const info = current.info

  return info === null
    ? current.label
    : `${current.label} · ${info.headRefName ?? info.headSha.slice(0, 7)} → ${info.baseRefName ?? info.baseRef}`
}

export function statusLine(current: Review): string {
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

export const foldLabel = (folded: boolean) => (folded ? 'unfold' : 'fold')

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

/** Cells of each side in the side-by-side view: half the room, less the
 * one cell between the sides. Both sides get the same width, so a context
 * line wraps alike on both. */
function sideWidth(columns: number): number {
  return Math.floor((columns - 1) / 2)
}

/** One side of a block as drawn: the Code's source and each line's rows. */
interface SplitSide {
  indexes: number[]
  source: string
  /** Cells of the gutter's number. The engine pads its own numbers to the
   * block's widest, so a block of 9s beside a block of 10s would start its
   * code a cell further left; the gutter takes up that cell instead. */
  labelDigits: number
  lineRows: number[]
  rows: number
}

interface SplitPiece {
  block: SplitBlock
  old: SplitSide
  new: SplitSide
}

interface SplitHunk {
  pieces: SplitPiece[]
}

const SPLIT = new WeakMap<Hunk, { columns: number; split: SplitHunk }>()

/** The hunk side by side at `columns` cells, kept per hunk like lineRows. A
 * side's code room is its width less its gutter (label + 1) and the engine's
 * prefix in its Code (that block's digits + 3): with the label padded as
 * SplitSide says, 2 * digits + 4 on every block. */
function splitAt(hunk: Hunk, columns: number): SplitHunk {
  const kept = SPLIT.get(hunk)
  if (kept !== undefined && kept.columns === columns) return kept.split
  const blocks = splitHunk(hunk)
  const all = (side: 'left' | 'right') => blocks.flatMap(block => block[side])
  // Each side's widest number in the whole hunk.
  const digits = { old: sideDigits(hunk, all('left'), 'old'), new: sideDigits(hunk, all('right'), 'new') }
  const width = sideWidth(columns)
  const side = (indexes: number[], which: Side): SplitSide => {
    const labelDigits = 2 * digits[which] - sideDigits(hunk, indexes, which)
    const room = width - 2 * digits[which] - 4
    const lineRows = indexes.map(i => codeRows(hunk.lines[i]?.content ?? '', room))
    const rows = lineRows.reduce((a, n) => a + n, 0)

    return { indexes, source: sideSource(hunk, indexes, which), labelDigits, lineRows, rows }
  }
  const pieces = blocks.map(block => ({ block, old: side(block.left, 'old'), new: side(block.right, 'new') }))
  const split = { pieces }
  SPLIT.set(hunk, { columns, split })

  return split
}

/** The rows each part takes at `columns` cells, by the rules the drawing follows. */
function measureAt(columns: number, view: DiffView): RowMeasure {
  return {
    fileHeader: (file, folded) => wrapWords(fileHeader(file), fileHeaderRoom(file, folded, columns)).length,
    hunkHeader: (_, hunk) => wrapWords(renderHunkHeader(hunk), columns - beside('+hunk')).length,
    body: hunk =>
      view === 'split'
        ? splitAt(hunk, columns).pieces.map(piece => Math.max(piece.old.rows, piece.new.rows))
        : lineRows(hunk, columns),
  }
}

/** The gutter label, one row: a mark on the anchored row, then the number
 * right-aligned to the widest. `▸42` and ` 41`. */
function gutterLabel(number: number | null, digits: number, anchored: boolean): string {
  return `${anchored ? '▸' : ' '}${String(number ?? '').padStart(digits)}`
}

export function renderPane(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  current: Review | null,
  anchor: Anchor,
  actions: PaneActions,
  view: DiffView = 'unified',
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
  const head = headLine(current)
  const switchLabel = `auto-commit: ${current.commits ? 'on' : 'off'}`
  const viewLabel = `side-by-side: ${view === 'split' ? 'on' : 'off'}`
  const cached = diffCache.current
  const diff = info !== null && cached !== null && cached.key === info.key ? cached.diff : null
  const folded = new Set(files.filter(f => f.folded).map(f => f.id))
  // Of the files that have hunks to fold, how many are folded: `1/3 folded`.
  // Empty until the diff has loaded.
  const foldable = diff === null ? [] : diff.files.filter(file => file.hunks.length > 0)
  const foldedCount = diff === null ? '' : `${foldable.filter(file => folded.has(file.id)).length}/${foldable.length} folded`
  // The cells the fold count takes after the head, its gap included.
  const countCells = foldedCount === '' ? 0 : foldedCount.length + 1
  // The switches sit beside the head and its fold count while the head keeps
  // HEAD_ROOM cells; in a narrower pane they move under it, on one row or,
  // narrower still, two. The fold count stays beside the head either way.
  const switchCells = beside(viewLabel, switchLabel) - 1
  const switchesBeside = columns - switchCells - 1 - countCells >= HEAD_ROOM
  const switchRows = switchesBeside ? 0 : switchCells <= columns ? 1 : 2
  const headRows = wrapWords(head, (switchesBeside ? columns - switchCells - 1 : columns) - countCells)
  const statusRows = wrapWords(statusLine(current), columns)

  const sections = []
  // Whether the tree is taller than the window, so the head can scroll away.
  let scrollable = false
  if (diff !== null) {
    const layout = layoutDiff(diff, folded, headRows.length + switchRows + statusRows.length, measureAt(columns, view))
    scrollable = layout.rows > e.props.scroll.bodyRows
    // The hunks near the window, in order, until the budget is spent.
    const sources = new Map<string, string>()
    let chars = 0
    for (const slot of hunksNear(layout, e.props.scroll)) {
      const source =
        view === 'split'
          ? splitAt(slot.hunk, columns)
              .pieces.map(piece => piece.old.source + piece.new.source)
              .join('')
          : renderHunk(slot.hunk, { noNewlineNote: false })
      if (chars + source.length > BUDGET) break
      chars += source.length
      sources.set(slot.key, source)
    }
    for (const slot of layout.files) {
      const file = slot.file
      const isFolded = folded.has(file.id)
      sections.push(
        <Box key={slot.key} flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {wrapWords(fileHeader(file), fileHeaderRoom(file, isFolded, columns)).map((row, i) => (
                <Text key={`fh:${file.id}:${i}`} bold wrap="truncate-end">
                  {row}
                </Text>
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
                      <Text key={`hh:${hunkSlot.key}:${i}`} dimColor wrap="truncate-end">
                        {row}
                      </Text>
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
                {view === 'split' ? (
                  <Box flexDirection="column">
                    {splitAt(hunkSlot.hunk, columns).pieces.map((piece, b) => (
                      <Box key={`block:${hunkSlot.key}:${b}`} flexDirection="row" gap={1} height={hunkSlot.bodyRows[b] ?? 1}>
                        {(['old', 'new'] as const).map(which => {
                          const side = piece[which]

                          return (
                            <Box key={`side:${which}:${hunkSlot.key}:${b}`} flexDirection="row" width={sideWidth(columns)} flexShrink={0}>
                              <Box flexDirection="column" flexShrink={0}>
                                {side.indexes.map((row, i) => (
                                  <Box key={`gutter:${which}:${file.id}:${hunkSlot.index}:${row}`} height={side.lineRows[i] ?? 1}>
                                    <Button
                                      key={`line:${which}:${file.id}:${hunkSlot.index}:${row}`}
                                      plain
                                      dimColor={row === anchoredRow ? undefined : true}
                                      label={gutterLabel(
                                        lines[row] === undefined ? null : sideNumber(lines[row], which),
                                        side.labelDigits,
                                        row === anchoredRow,
                                      )}
                                      onPress={() => actions.pressGutter({ file: file.path, hunk: hunkSlot.index, row })}
                                    />
                                  </Box>
                                ))}
                              </Box>
                              {side.source !== '' && (
                                <Box flexGrow={1} flexShrink={1}>
                                  <Code format="diff" source={side.source} path={file.path} wrap="wrap" />
                                </Box>
                              )}
                            </Box>
                          )
                        })}
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Box flexDirection="row">
                    <Box flexDirection="column" flexShrink={0}>
                      {lines.map((line, row) => (
                        <Box key={`gutter:${file.id}:${hunkSlot.index}:${row}`} height={hunkSlot.bodyRows[row] ?? 1}>
                          <Button
                            key={`line:${file.id}:${hunkSlot.index}:${row}`}
                            plain
                            dimColor={row === anchoredRow ? undefined : true}
                            label={gutterLabel(rowNumber(line), digits, row === anchoredRow)}
                            onPress={() => actions.pressGutter({ file: file.path, hunk: hunkSlot.index, row })}
                          />
                        </Box>
                      ))}
                    </Box>
                    <Box flexGrow={1} flexShrink={1}>
                      <Code format="diff" source={source} path={file.path} wrap="wrap" />
                    </Box>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>,
      )
    }
  }

  const switches = [
    <Button key="view" plain label={viewLabel} onPress={() => actions.toggleView()} />,
    <Button key="commits" plain label={switchLabel} onPress={() => actions.toggleCommits()} />,
  ]
  const headText = (
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
      {headRows.map((row, i) => (
        <Text key={`head:${i}`} bold wrap="truncate-end">
          {row}
        </Text>
      ))}
    </Box>
  )
  const count = foldedCount !== '' && <Text dimColor>{foldedCount}</Text>

  // Once the head has scrolled away, a sticky head stands in for it at the
  // window's top: the head, how many files are folded, and the two switches, beside it or under it as in the head
  // proper. It is laid over the diff, out of the flow, so the rows the layout counted do not move. Every
  // cell is written, the gaps as spaces, so no line beneath shows through. At
  // the top nothing is laid over, and the head shows as drawn.
  const sticky = () => {
    const label = foldedCount
    const row = stickyRow(head, label, switchesBeside ? columns - switchCells - 1 : columns)
    const gap = (key: string) => <Text key={key}> </Text>

    return (
      <Box key="sticky" position="absolute" top={e.props.scroll.offset} left={0} width={columns} flexDirection="column">
        <Box flexDirection="row">
          <Text bold wrap="truncate-end">
            {row.head}
          </Text>
          <Text dimColor>{row.label}</Text>
          {switchesBeside && [gap('gap:1'), stickySwitches[0], gap('gap:2'), stickySwitches[1]]}
        </Box>
        {!switchesBeside && switchRows <= 1 && (
          <Box flexDirection="row">
            {stickySwitches[0]}
            {gap('gap:2')}
            {stickySwitches[1]}
            <Text>{fill('', columns - switchCells)}</Text>
          </Box>
        )}
        {!switchesBeside &&
          switchRows === 2 &&
          [viewLabel, switchLabel].map((label, i) => (
            <Box key={`sticky:${i}`} flexDirection="row">
              {stickySwitches[i]}
              <Text>{fill('', columns - label.length)}</Text>
            </Box>
          ))}
      </Box>
    )
  }
  const stickySwitches = [
    <Button key="sticky:view" plain label={viewLabel} onPress={() => actions.toggleView()} />,
    <Button key="sticky:commits" plain label={switchLabel} onPress={() => actions.toggleCommits()} />,
  ]

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        {headText}
        {count}
        {switchesBeside && switches}
      </Box>
      {!switchesBeside && (
        <Box flexDirection={switchRows === 1 ? 'row' : 'column'} gap={switchRows === 1 ? 1 : 0}>
          {switches}
        </Box>
      )}
      {statusRows.map((row, i) => (
        <Text key={`status:${i}`} dimColor wrap="truncate-end">
          {row}
        </Text>
      ))}
      {current.phase === 'open' && diff === null && <Text dimColor>Loading the diff…</Text>}
      {sections}
      {scrollable && e.props.scroll.offset > 0 && sticky()}
    </Box>
  )
}
