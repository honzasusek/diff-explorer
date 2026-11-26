import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { DiffView, Review, ReviewFile } from '../types'
import type { DiffFile, DiffLine, Hunk, HunkRow, Side } from '../core/types.ts'
import type { Anchor } from '../core/diff/selection.ts'
import { layoutDiff } from '../core/diff/layout.ts'
import { cut, subHunk } from '../core/diff/window.ts'
import type { HunkSlot, RowMeasure } from '../core/diff/layout.ts'
import { renderHunk, renderHunkHeader } from '../core/diff/patchRenderer.ts'
import { sideDigits, sideNumber, sideSource, splitHunk } from '../core/diff/split.ts'
import type { SplitBlock } from '../core/diff/split.ts'
import { codeRows, wrapWords } from '../core/diff/wrap.ts'
import { diffCache, paneWindow } from './state.ts'

// The diff pane. Top to bottom: a head line with two switches, the
// side-by-side view and auto-commit (whether Claude may commit in this
// checkout), a status line, then every file's header and its hunks, each
// hunk a diff Code under a header, with a column of line-number buttons
// beside the Code: the gutter, where two presses pick a range. Side by side,
// a hunk is drawn as blocks (core/diff/split.ts), each side of a block its
// own Code with its own gutter.
//
// The pane scrolls the diff itself, so the head never moves. The tree is the
// head, then a window as tall as the room left under it, which shows the diff
// from row `top` (core/diff/layout.ts counts the rows). The engine's own
// window never moves: register.tsx answers each wheel tick or scroll key by
// moving `top`. With 30 body rows, a head of 3 and `top` 100, the window
// shows diff rows 100 to 126.
//
// Only what the window shows is drawn, so a drawing stays far under the
// engine's 100,000 characters. A hunk the window's top cuts through is drawn
// from the first line it shows, as a hunk of its own (subHunk), so the engine
// numbers its lines as before; a wrapped line cut through is pulled up by its
// rows above the window, which the window clips.
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

/** Lines a hunk's slice may run on under the window to reach a line number
 * as wide as the hunk's widest: at about 50 characters a line, 500 lines
 * keep a drawing far under the engine's 100,000 characters. */
const WIDE_REACH = 500

/** Cells the head's text keeps beside the switches before they move under it. */
const HEAD_ROOM = 20

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
  /** Each side's widest number in the whole hunk. */
  digits: { old: number; new: number }
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
  const split = { pieces, digits }
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
  top = 0,
) {
  const { Box, Text, Button, Code } = $.ui.resolve(e)

  if (current === null) {
    paneWindow.current = null

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
  const loading = current.phase === 'open' && diff === null
  // The diff's room under the head, at least a row, and the window over it:
  // `offset` is `top` kept inside the diff, `shown` the rows the window takes,
  // fewer than the room when the whole diff fits.
  const windowRows = Math.max(1, e.props.scroll.bodyRows - headRows.length - switchRows - statusRows.length - (loading ? 1 : 0))
  let offset = 0
  let shown = 0
  // One blank row under the window while the diff is longer than it, so the
  // engine has a row to scroll and raises the arrow keys and Home and End
  // (register.tsx); the engine's window never moves, so it stays out of sight.
  let spare = false
  paneWindow.current = null
  if (diff !== null) {
    const layout = layoutDiff(diff, folded, 0, measureAt(columns, view))
    const maxTop = Math.max(0, layout.rows - windowRows)
    offset = Math.min(Math.max(0, top), maxTop)
    shown = Math.min(windowRows, layout.rows)
    spare = layout.rows > windowRows
    paneWindow.current = { layout, windowRows, maxTop }
    // Only what the window shows is drawn, each part cut at the window's top.
    // A wrapped line the top cuts through is pulled up by the rows above it,
    // at most the head's rows: the terminal drops a drawing pushed above the
    // screen's first row, and the head's rows are known to be on screen.
    const end = offset + windowRows
    const lift = headRows.length + switchRows + statusRows.length
    for (const slot of layout.files) {
      if (slot.top + slot.rows <= offset) continue
      if (slot.top >= end) break
      const file = slot.file
      const isFolded = folded.has(file.id)
      const headerRows = wrapWords(fileHeader(file), fileHeaderRoom(file, isFolded, columns)).slice(Math.max(0, offset - slot.top))
      const parts = []
      if (headerRows.length > 0) {
        parts.push(
          <Box key={`fh:${file.id}`} flexDirection="row" gap={1}>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {headerRows.map((row, i) => (
                <Text key={`fh:${file.id}:${i}`} bold wrap="truncate-end">
                  {row}
                </Text>
              ))}
            </Box>
            {file.hunks.length > 0 && (
              <Button key={`file+:${file.id}`} plain dimColor label="+file" onPress={() => actions.addFile(file)} />
            )}
            {file.hunks.length > 0 && (
              <Button key={`fold:${file.id}`} plain dimColor label={foldLabel(isFolded)} onPress={() => actions.toggleFold(file.id)} />
            )}
          </Box>,
        )
      }
      for (const hunkSlot of slot.hunks) {
        if (hunkSlot.top + hunkSlot.rows <= offset) continue
        if (hunkSlot.top >= end) break
        parts.push(drawHunk(file, hunkSlot, offset - hunkSlot.top, end - hunkSlot.top))
      }
      // A section keeps its rows: the window clips what runs past its
      // bottom, where a shrinking section would squeeze the ones above.
      sections.push(
        <Box key={slot.key} flexDirection="column" flexShrink={0}>
          {parts}
        </Box>,
      )
    }

    /** One hunk's rows from `from` to `to`, counted from its header's first row. */
    function drawHunk(file: DiffFile, hunkSlot: HunkSlot, from: number, to: number) {
      const hunk = hunkSlot.hunk
      const header = renderHunkHeader(hunk)
      const headerRows = wrapWords(header, columns - beside('+hunk')).slice(Math.max(0, from))
      const anchoredRow = anchor !== null && anchor.file === file.path && anchor.hunk === hunkSlot.index ? anchor.row : -1
      const bodyTo = to - hunkSlot.headerRows
      const body = cut(hunkSlot.bodyRows, Math.max(0, from - hunkSlot.headerRows), bodyTo)
      const gutter = (key: string, row: number, rows: number, label: string) => (
        <Box key={`gutter:${key}`} height={rows}>
          <Button
            key={`line:${key}`}
            plain
            dimColor={row === anchoredRow ? undefined : true}
            label={label}
            onPress={() => actions.pressGutter({ file: file.path, hunk: hunkSlot.index, row })}
          />
        </Box>
      )
      // Rows clipped to `height`, the first `pulled` of them above its top.
      const clipped = (key: string, height: number, pulled: number, width: number, inner: RenderElement[]) => (
        <Box key={key} height={height} width={width} flexShrink={0} overflow="hidden">
          <Box position="absolute" top={-pulled} left={0} width={width} flexDirection="row">
            {inner}
          </Box>
        </Box>
      )
      const rowsOf = (from: number, end: number) => hunkSlot.bodyRows.slice(from, end).reduce((a, n) => a + n, 0)

      let drawnBody: RenderElement | RenderElement[] = []
      if (body.first < body.end && view === 'split') {
        const split = splitAt(hunk, columns)
        drawnBody = split.pieces.slice(body.first, body.end).map((piece, i) => {
          const b = body.first + i
          // The window may start inside the first block: each side from its
          // line at that row, that line's rows above it pulled out of sight,
          // and up to the row where the window ends.
          const into = i === 0 ? body.above : 0
          const blockTop = rowsOf(0, b)
          const height = Math.min((hunkSlot.bodyRows[b] ?? 1) - into, bodyTo - blockTop - into)

          return (
            <Box key={`block:${hunkSlot.key}:${b}`} flexDirection="row" gap={1} height={height}>
              {(['old', 'new'] as const).map(which => {
                const side = piece[which]
                const at = cut(side.lineRows, into, into + height)
                const indexes = side.indexes.slice(at.first, at.end)
                const source = sideSource(hunk, indexes, which)
                // The engine pads its numbers to the widest it draws; the label
                // takes up what a narrower piece leaves, so the code stays put.
                const labelDigits = 2 * split.digits[which] - sideDigits(hunk, indexes, which)
                const width = sideWidth(columns)

                return clipped(
                  `side:${which}:${hunkSlot.key}:${b}`,
                  height,
                  Math.min(at.above, lift),
                  width,
                  [
                    <Box key="gutter" flexDirection="column" flexShrink={0}>
                      {indexes.map((row, k) =>
                        gutter(
                          `${which}:${file.id}:${hunkSlot.index}:${row}`,
                          row,
                          side.lineRows[at.first + k] ?? 1,
                          gutterLabel(hunk.lines[row] === undefined ? null : sideNumber(hunk.lines[row], which), labelDigits, row === anchoredRow),
                        ),
                      )}
                    </Box>,
                    ...(source === ''
                      ? []
                      : [
                          <Box key="code" flexGrow={1} flexShrink={1}>
                            <Code format="diff" source={source} path={file.path} wrap="wrap" />
                          </Box>,
                        ]),
                  ],
                )
              })}
            </Box>
          )
        })
      } else if (body.first < body.end) {
        // The engine pads its numbers to the widest it draws, so a slice of
        // narrower numbers than the hunk's would shift them a cell. The slice
        // runs on, out of sight under the window, to a line as wide as the
        // hunk's widest, while that is near; past that the label takes up
        // the cells the engine's numbers leave, so the code stays put.
        const widest = hunkDigits(hunk)
        let end = body.end
        if (hunkDigits(subHunk(hunk, body.first, end)) < widest) {
          const wide = hunk.lines.findIndex((line, i) => i >= end && String(rowNumber(line) ?? '').length >= widest)
          if (wide !== -1 && wide - end < WIDE_REACH) end = wide + 1
        }
        const sub = subHunk(hunk, body.first, end)
        const labelDigits = 2 * widest - hunkDigits(sub)
        const pulled = Math.min(body.above, lift)
        drawnBody = clipped(
          `body:${hunkSlot.key}`,
          rowsOf(body.first, end) - pulled,
          pulled,
          columns,
          [
            <Box key="gutter" flexDirection="column" flexShrink={0}>
              {sub.lines.map((line, k) => {
                const row = body.first + k

                return gutter(
                  `${file.id}:${hunkSlot.index}:${row}`,
                  row,
                  hunkSlot.bodyRows[row] ?? 1,
                  gutterLabel(rowNumber(line), labelDigits, row === anchoredRow),
                )
              })}
            </Box>,
            <Box key="code" flexGrow={1} flexShrink={1}>
              <Code format="diff" source={renderHunk(sub, { noNewlineNote: false })} path={file.path} wrap="wrap" />
            </Box>,
          ],
        )
      }

      return (
        <Box key={hunkSlot.key} flexDirection="column">
          {headerRows.length > 0 && (
            <Box key={`hh:${hunkSlot.key}`} flexDirection="row" gap={1}>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                {headerRows.map((row, i) => (
                  <Text key={`hh:${hunkSlot.key}:${i}`} dimColor wrap="truncate-end">
                    {row}
                  </Text>
                ))}
              </Box>
              <Button key={`hunk+:${file.id}:${hunkSlot.index}`} plain dimColor label="+hunk" onPress={() => actions.addHunk(file, hunkSlot.index)} />
            </Box>
          )}
          {drawnBody}
        </Box>
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
      {loading && <Text dimColor>Loading the diff…</Text>}
      {diff !== null && (
        <Box key="window" height={shown} flexShrink={0} overflow="hidden" flexDirection="column">
          {sections}
        </Box>
      )}
      {spare && <Box key="spare" height={1} flexShrink={0} />}
    </Box>
  )
}
