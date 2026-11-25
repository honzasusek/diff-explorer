import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { DiffView, Review } from '../types'
import type { DiffFile, DiffLine, Hunk } from '../core/types.ts'
import type { Anchor } from '../core/diff/selection.ts'
import { renderHunkHeader } from '../core/diff/patchRenderer.ts'
import { splitHunk } from '../core/diff/split.ts'
import { fileHeader, foldLabel, headLine, plural, statusLine } from './pane.tsx'
import type { PaneActions } from './pane.tsx'
import { diffCache } from './state.ts'

// The diff pane as the desktop app draws it. The terminal's pane (pane.tsx)
// sizes everything in character rows: each gutter button is as tall as its
// line's wrapped rows, and a sticky head is laid at the window's row offset.
// The desktop draws in pixels with its own fonts, so those heights miss, and
// its diff Code is a card with a header and padding of its own, so a gutter
// beside it never lines up.
//
// Here every diff line is one row instead: its line numbers, a button that
// picks it as the gutter does, beside the line's text in the monospaced face,
// tinted as added or removed. Number and text share a row, so they stay level
// however the line wraps. Side by side, a row holds the old line and the new
// one, so the two sides stay level too. The price is the syntax colours,
// which only the engine's Code draws.
//
// A drawing travels to the app as JSON, capped at 100,000 characters and
// 20,000 elements; over either, the app keeps its last drawing (it showed
// "Opening..." for good). A diff line costs its text and about LINE_COST
// characters of elements and props, so the lines are drawn from the start
// line on until lineBudget is spent, cutting a hunk where the budget ends.
// What is left out, before or after, is one row per stretch with a button
// that starts the drawing there. The start is a line, `src-a-ts:2:40` (file,
// hunk, line), since one lockfile hunk alone can pass the cap.
// there. Keys are kept short for the same reason: `g3.1.4` is the gutter of
// file 3, hunk 1, line 4.

/** What a drawn diff line costs on the wire beyond its text: the row, its
 * gutter Button and the two Texts, with their props and keys. A line of the
 * test kit's tree measured 420 (hooks/register.test.tsx, the desktop size
 * test), so this keeps a little room. */
const LINE_COST = 440

/** What a file costs beyond its lines: its header row, its buttons, and a
 * row for hunks left out. */
const FILE_COST = 700

/** Characters a drawing may spend, below the app's cap of 100,000 for the
 * head, the status and anything the estimate misses. */
const WIRE_BUDGET = 92_000

/** The budget for diff lines once the files' own rows are paid for:
 * `lineBudget(15)` is 81,500. At least 20,000, so a diff of many files still
 * draws some lines. */
export function lineBudget(files: number): number {
  return Math.max(20_000, WIRE_BUDGET - files * FILE_COST)
}

/** The lines of one hunk drawn: from `start` up to, not including, `end`. */
export interface DrawnRange {
  start: number
  end: number
}

/** The lines drawn, per hunk key (`src-a-ts:2`): from the line keyed `from`
 * (`src-a-ts:2:40`; the top when null or gone) on, in order, each line
 * costing its text and LINE_COST, until `budget` is spent; folded files
 * are passed over. At least one line, however long. With a budget of three
 * 10-character lines and hunks of 2 and 4, from the top: hunk 0 lines 0-2,
 * hunk 1 line 0 only. */
export function drawnRanges(
  files: readonly DiffFile[],
  folded: ReadonlySet<string>,
  from: string | null,
  budget: number,
): Map<string, DrawnRange> {
  const order = files.flatMap(file => (folded.has(file.id) ? [] : file.hunks.map((hunk, i) => ({ key: `${file.id}:${i}`, hunk }))))
  const [fromHunk, fromLine] =
    from === null ? [null, 0] : [from.slice(0, from.lastIndexOf(':')), Number(from.slice(from.lastIndexOf(':') + 1))]
  const found = order.findIndex(entry => entry.key === fromHunk)
  const drawn = new Map<string, DrawnRange>()
  let spent = 0
  let lines = 0
  for (const [n, entry] of order.slice(Math.max(0, found)).entries()) {
    const first = n === 0 && found >= 0 ? Math.min(Math.max(0, fromLine || 0), entry.hunk.lines.length) : 0
    let end = first
    for (const line of entry.hunk.lines.slice(first)) {
      const next = line.content.length + LINE_COST
      if (lines > 0 && spent + next > budget) break
      spent += next
      lines += 1
      end += 1
    }
    if (end > first || entry.hunk.lines.length === 0) drawn.set(entry.key, { start: first, end })
    if (end < entry.hunk.lines.length) break
  }

  return drawn
}

/** The number of digits of a hunk's widest line number, either side. */
function digitsOf(hunk: Hunk): number {
  return Math.max(1, ...hunk.lines.map(line => String(Math.max(line.oldNo ?? 0, line.newNo ?? 0)).length))
}

/** A number padded to `digits`, blank when absent: `pad(7, 3)` is `'  7'`. */
function pad(number: number | null, digits: number): string {
  return String(number ?? '').padStart(digits)
}

/** The marker and tint of a line: `+` on the added colour, `-` on the removed. */
function look(line: DiffLine): {
  mark: string
  tint: 'diffAdded' | 'diffRemoved' | undefined
} {
  if (line.type === 'add') return { mark: '+', tint: 'diffAdded' }
  if (line.type === 'del') return { mark: '-', tint: 'diffRemoved' }
  return { mark: ' ', tint: undefined }
}

export function renderRichPane(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  current: Review | null,
  anchor: Anchor,
  actions: PaneActions,
  view: DiffView = 'unified',
  from: string | null = null,
) {
  const { Box, Text, Button } = $.ui.resolve(e)

  if (current === null) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Nothing open. Run /explore {'<pr number>'}.</Text>
      </Box>
    )
  }

  const info = current.info
  const files = current.files ?? []
  const cached = diffCache.current
  const diff = info !== null && cached !== null && cached.key === info.key ? cached.diff : null
  const folded = new Set(files.filter(f => f.folded).map(f => f.id))
  const foldable = diff === null ? [] : diff.files.filter(file => file.hunks.length > 0)
  const foldedCount = `${foldable.filter(file => folded.has(file.id)).length}/${foldable.length} folded`

  /** The gutter of one line: a button showing its numbers, `▸` on the anchor. */
  const gutter = (file: DiffFile, hunk: number, row: number, label: string, anchored: boolean, key: string) => (
    <Button key={key} plain dimColor={anchored ? undefined : true} onPress={() => actions.pressGutter({ file: file.path, hunk, row })}>
      <Text mono tabular>
        {`${anchored ? '▸' : ' '}${label} `}
      </Text>
    </Button>
  )

  /** One line's text in the monospaced face; a blank line keeps a space so its row keeps its height. */
  const code = (line: DiffLine) => (
    <Text mono wrap="wrap">
      {`${look(line).mark}${line.content === '' ? ' ' : line.content}`}
    </Text>
  )

  const unified = (file: DiffFile, f: number, hunk: Hunk, index: number, anchoredRow: number, range: DrawnRange) => {
    const digits = digitsOf(hunk)

    return hunk.lines
      .slice(range.start, range.end)
      .map((line, i) => ({ line, row: range.start + i }))
      .map(({ line, row }) => (
        <Box key={`r${f}.${index}.${row}`} flexDirection="row" backgroundColor={look(line).tint}>
          {gutter(file, index, row, `${pad(line.oldNo, digits)} ${pad(line.newNo, digits)}`, row === anchoredRow, `g${f}.${index}.${row}`)}
          {code(line)}
        </Box>
      ))
  }

  const split = (file: DiffFile, f: number, hunk: Hunk, index: number, anchoredRow: number, range: DrawnRange) => {
    const inside = (i: number) => i >= range.start && i < range.end
    const digits = digitsOf(hunk)
    // One side of one row: its number and text, or a blank half where the side ran out.
    const half = (row: number | undefined, which: 'o' | 'n', key: string) => {
      const line = row === undefined ? undefined : hunk.lines[row]
      if (row === undefined || line === undefined) return <Box key={key} width="50%" flexShrink={0} />
      const number = which === 'o' ? line.oldNo : line.newNo

      return (
        <Box key={key} width="50%" flexShrink={0} flexDirection="row" backgroundColor={look(line).tint}>
          {gutter(file, index, row, pad(number, digits), row === anchoredRow, `g${which}${f}.${index}.${row}`)}
          {code(line)}
        </Box>
      )
    }

    // A block cut by the range keeps only its lines inside it.
    return splitHunk(hunk)
      .map(block => ({
        ...block,
        left: block.left.filter(inside),
        right: block.right.filter(inside),
      }))
      .flatMap((block, b) =>
        Array.from({ length: Math.max(block.left.length, block.right.length) }, (_, i) => (
          <Box key={`p${f}.${index}.${b}.${i}`} flexDirection="row">
            {half(block.left[i], 'o', `o${f}.${index}.${b}.${i}`)}
            {half(block.right[i], 'n', `n${f}.${index}.${b}.${i}`)}
          </Box>
        )),
      )
  }

  /** The row standing for lines left out of the drawing, with the button
   * that starts the drawing at the first of them, keyed `src-a-ts:2:40`. */
  const leftOut = (f: number, lines: number, hunks: number, target: string) => (
    <Box key={`x${f}.${target}`} flexDirection="row" gap={1} marginTop={1}>
      <Text dimColor>
        {hunks > 1 ? `${plural(hunks, 'hunk')}, ${plural(lines, 'line')}, not drawn` : `${plural(lines, 'line')} not drawn`}
      </Text>
      <Button key={`from:${target}`} plain label="draw from here" onPress={() => actions.drawFrom(target)} />
    </Box>
  )

  const sections: RenderElement[] = []
  if (diff !== null) {
    const drawn = drawnRanges(diff.files, folded, from, lineBudget(diff.files.length))
    diff.files.forEach((file, f) => {
      const isFolded = folded.has(file.id)
      const rows: RenderElement[] = []
      // Whole hunks left out in a row, shown as one row once a drawn hunk or the file's end comes.
      let run: number[] = []
      const flush = () => {
        const first = run[0]
        if (first !== undefined) {
          const lines = run.reduce((sum, i) => sum + (file.hunks[i]?.lines.length ?? 0), 0)
          rows.push(leftOut(f, lines, run.length, `${file.id}:${first}:0`))
        }
        run = []
      }
      if (!isFolded) {
        file.hunks.forEach((hunk, index) => {
          const range = drawn.get(`${file.id}:${index}`)
          if (range === undefined) {
            run.push(index)
            return
          }
          flush()
          const anchoredRow = anchor !== null && anchor.file === file.path && anchor.hunk === index ? anchor.row : -1
          rows.push(
            <Box key={`h${f}.${index}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text mono dimColor>
                    {renderHunkHeader(hunk)}
                  </Text>
                </Box>
                <Button key={`hunk+:${file.id}:${index}`} plain dimColor label="+hunk" onPress={() => actions.addHunk(file, index)} />
              </Box>
              {range.start > 0 && leftOut(f, range.start, 1, `${file.id}:${index}:0`)}
              {view === 'split' ? split(file, f, hunk, index, anchoredRow, range) : unified(file, f, hunk, index, anchoredRow, range)}
              {range.end < hunk.lines.length && leftOut(f, hunk.lines.length - range.end, 1, `${file.id}:${index}:${range.end}`)}
            </Box>,
          )
        })
        flush()
      }
      sections.push(
        <Box key={`f${f}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text weight="semibold">{fileHeader(file)}</Text>
            </Box>
            {file.hunks.length > 0 && (
              <Button key={`file+:${file.id}`} plain dimColor label="+file" onPress={() => actions.addFile(file)} />
            )}
            {file.hunks.length > 0 && (
              <Button key={`fold:${file.id}`} plain dimColor label={foldLabel(isFolded)} onPress={() => actions.toggleFold(file.id)} />
            )}
          </Box>
          {rows}
        </Box>,
      )
    })
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={2} flexWrap="wrap">
        <Box flexGrow={1} flexShrink={1}>
          <Text weight="semibold">{headLine(current)}</Text>
        </Box>
        {diff !== null && <Text dimColor>{foldedCount}</Text>}
        <Button key="view" plain label={`side-by-side: ${view === 'split' ? 'on' : 'off'}`} onPress={() => actions.toggleView()} />
        <Button key="commits" plain label={`auto-commit: ${current.commits ? 'on' : 'off'}`} onPress={() => actions.toggleCommits()} />
      </Box>
      <Text dimColor>{statusLine(current)}</Text>
      {current.phase === 'open' && diff === null && <Text dimColor>Loading the diff…</Text>}
      {sections}
    </Box>
  )
}
