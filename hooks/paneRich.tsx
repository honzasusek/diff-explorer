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
// A drawing reaches the app as JSON, refused over 100,000 characters or
// 20,000 elements; the app then keeps its last drawing (0.2.4 stayed on
// "Opening..."). An element costs about 100 characters whatever it holds, so
// a row per line spends the cap on structure. Instead each hunk is one Text
// in the monospaced face, its numbers written into each line, so they stay
// level with the code however a line wraps:
//
//   40 40  const res = await fetch(url, opts);
//   41    -if (!res.ok) throw new Error(res.status);
//      41 +if (!res.ok && retryable(res)) {
//
// Lines of one kind in a row are one run: context runs are plain strings, an
// added or removed run one nested Text on its tint. The drawing then costs
// about the diff's own text. Side by side, a hunk's blocks (core/diff/split.ts)
// are rows of two such Texts, so each block starts level on both sides.
//
// A block of text has no line to press. So picking lines is a mode: the hunk
// named by `picking` is drawn a line per row, each with its numbers as a
// button that presses as the terminal's gutter does. One hunk costs little.

/** Characters the drawing may spend, below the app's cap of 100,000 for the
 * head and anything the estimate misses. */
const WIRE_BUDGET = 92_000

/** What an element costs on the wire beyond its text, with its props: a run's
 * nested Text, a hunk's Box or a header row. Measured on the test kit's tree. */
const ELEMENT_COST = 110

/** What a line costs in pick mode: its row, its button and two Texts. */
const PICK_LINE_COST = 440

/** Lines in pick mode at most, half the budget: about a hundred. A longer
 * hunk is picked from past there by typing `#path:from-to`. */
const PICK_LIMIT = Math.floor(WIRE_BUDGET / 2 / PICK_LINE_COST)

interface Run {
  type: DiffLine['type']
  from: number
  to: number
}

/** Lines of one kind in a row, each run its kind and first and last index:
 * kinds `context, context, del` give `[{context 0-1}, {del 2-2}]`. */
export function runs(types: readonly DiffLine['type'][]): Run[] {
  const out: Run[] = []
  types.forEach((type, i) => {
    const last = out[out.length - 1]
    if (last !== undefined && last.type === type) last.to = i
    else out.push({ type, from: i, to: i })
  })

  return out
}

/** The number of digits of a hunk's widest line number, either side. */
function digitsOf(hunk: Hunk): number {
  return Math.max(1, ...hunk.lines.map(line => String(Math.max(line.oldNo ?? 0, line.newNo ?? 0)).length))
}

/** A number padded to `digits`, blank when absent: `pad(7, 3)` is `'  7'`. */
function pad(number: number | null, digits: number): string {
  return String(number ?? '').padStart(digits)
}

const MARK: Record<DiffLine['type'], string> = { add: '+', del: '-', context: ' ' }
const TINT: Record<DiffLine['type'], 'diffAdded' | 'diffRemoved' | undefined> = {
  add: 'diffAdded',
  del: 'diffRemoved',
  context: undefined,
}

/** One line as the unified block writes it: both numbers, the marker, the code.
 * An addition at new line 41 with two digits, `x`, is `'   41 +x'`. */
export function unifiedLine(line: DiffLine, digits: number): string {
  return `${pad(line.oldNo, digits)} ${pad(line.newNo, digits)} ${MARK[line.type]}${line.content}`
}

/** One side's line in the side-by-side view: that side's number, the marker,
 * the code; a space where the shorter side of a change block runs out. */
function sideLine(line: DiffLine | undefined, side: 'old' | 'new', digits: number): string {
  if (line === undefined) return ' '

  return `${pad(side === 'old' ? line.oldNo : line.newNo, digits)} ${MARK[line.type]}${line.content}`
}

/** What a hunk costs drawn as text: its characters with the numbers, and an
 * element per run and for its frame. */
function textCost(hunk: Hunk): number {
  const digits = digitsOf(hunk)
  const chars = hunk.lines.reduce((sum, line) => sum + line.content.length + 2 * digits + 4, 0)

  return chars + (runs(hunk.lines.map(line => line.type)).length + 6) * ELEMENT_COST
}

export function renderRichPane(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  current: Review | null,
  anchor: Anchor,
  actions: PaneActions,
  view: DiffView = 'unified',
  picking: string | null = null,
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

  /** Lines as one Text: a context run a plain string, a changed run a
   * nested Text on its tint. The newline after a tinted run stays outside
   * it, so the tint ends with the line. */
  const block = (lines: Array<{ type: DiffLine['type']; text: string }>, key: string) => {
    const children = runs(lines.map(line => line.type)).flatMap((run, r) => {
      const text = lines
        .slice(run.from, run.to + 1)
        .map(line => line.text)
        .join('\n')
      const tail = run.to < lines.length - 1 ? ['\n'] : []
      const tint = TINT[run.type]
      if (tint === undefined) return [text + tail.join('')]

      return [
        <Text backgroundColor={tint}>{text}</Text>,
        ...tail,
      ]
    })

    // The Box carries the key: a Text takes none, and a test or a scroll finds the block by it.
    return (
      <Box key={key}>
        <Text mono wrap="wrap">
          {children}
        </Text>
      </Box>
    )
  }

  const unified = (hunk: Hunk, key: string) => {
    const digits = digitsOf(hunk)

    return block(
      hunk.lines.map(line => ({ type: line.type, text: unifiedLine(line, digits) })),
      key,
    )
  }

  const split = (hunk: Hunk, key: string) => {
    const digits = digitsOf(hunk)
    const side = (indexes: number[], length: number, which: 'old' | 'new') =>
      Array.from({ length }, (_, i) => {
        const at = indexes[i]
        const line = at === undefined ? undefined : hunk.lines[at]

        return { type: line?.type ?? 'context', text: sideLine(line, which, digits) }
      })

    return splitHunk(hunk).map((b, n) => {
      const length = Math.max(b.left.length, b.right.length)

      return (
        <Box key={`${key}.b${n}`} flexDirection="row">
          <Box width="50%" flexShrink={0}>
            {block(side(b.left, length, 'old'), `${key}.o${n}`)}
          </Box>
          <Box width="50%" flexShrink={0}>
            {block(side(b.right, length, 'new'), `${key}.n${n}`)}
          </Box>
        </Box>
      )
    })
  }

  /** The hunk being picked from: a row per line, its numbers a button. The
   * first press anchors (`▸`), the second adds the range and ends the mode. */
  const pickRows = (file: DiffFile, hunk: Hunk, index: number) => {
    const digits = digitsOf(hunk)
    const anchoredRow = anchor !== null && anchor.file === file.path && anchor.hunk === index ? anchor.row : -1

    return hunk.lines.slice(0, PICK_LIMIT).map((line, row) => (
      <Box key={`r${row}`} flexDirection="row" backgroundColor={TINT[line.type]}>
        <Button
          key={`pick:${file.id}:${index}:${row}`}
          plain
          dimColor={row === anchoredRow ? undefined : true}
          onPress={() => {
            actions.pressGutter({ file: file.path, hunk: index, row })
            // A press while this hunk holds the anchor is the second: the range is added.
            if (anchoredRow !== -1) actions.pick(null)
          }}
        >
          <Text mono tabular>
            {`${row === anchoredRow ? '▸' : ' '}${pad(line.oldNo, digits)} ${pad(line.newNo, digits)} `}
          </Text>
        </Button>
        <Text mono wrap="wrap">
          {`${MARK[line.type]}${line.content}`}
        </Text>
      </Box>
    ))
  }

  const sections: RenderElement[] = []
  if (diff !== null) {
    // Hunks are drawn in order while the budget lasts. The picked hunk's
    // rows are paid for first, so picking always fits.
    const pickedLines =
      diff.files.flatMap(file => file.hunks.map((hunk, i) => ({ key: `${file.id}:${i}`, hunk }))).find(x => x.key === picking)?.hunk
        .lines.length ?? 0
    let spent = Math.min(pickedLines, PICK_LIMIT) * PICK_LINE_COST + diff.files.length * 4 * ELEMENT_COST
    diff.files.forEach((file, f) => {
      const isFolded = folded.has(file.id)
      const rows: RenderElement[] = []
      if (!isFolded) {
        file.hunks.forEach((hunk, index) => {
          const key = `${file.id}:${index}`
          const isPicking = key === picking
          const cost = isPicking ? 0 : textCost(hunk)
          const drawn = isPicking || spent + cost <= WIRE_BUDGET
          if (drawn) spent += cost
          const header = renderHunkHeader(hunk)
          rows.push(
            <Box key={`h${f}.${index}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" gap={2}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text mono dimColor>
                    {drawn
                      ? header
                      : `${header} · ${plural(hunk.lines.length, 'line')} not drawn: the app takes 100,000 characters at once, so fold a file to make room`}
                  </Text>
                </Box>
                <Button
                  key={`pick:${key}`}
                  plain
                  dimColor
                  label={isPicking ? 'done picking' : 'pick lines'}
                  onPress={() => actions.pick(isPicking ? null : key)}
                />
                <Button key={`hunk+:${key}`} plain dimColor label="+hunk" onPress={() => actions.addHunk(file, index)} />
              </Box>
              {isPicking && pickRows(file, hunk, index)}
              {isPicking && hunk.lines.length > PICK_LIMIT && (
                <Text dimColor>{`${plural(hunk.lines.length - PICK_LIMIT, 'more line')}: type #${file.path}:from-to in the prompt to pick past here`}</Text>
              )}
              {!isPicking && drawn && (view === 'split' ? split(hunk, `t${f}.${index}`) : unified(hunk, `t${f}.${index}`))}
            </Box>,
          )
        })
      }
      sections.push(
        <Box key={`f${f}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={2}>
            <Box flexGrow={1} flexShrink={1}>
              <Text weight="semibold">{fileHeader(file)}</Text>
            </Box>
            {file.hunks.length > 0 && <Button key={`file+:${file.id}`} plain dimColor label="+file" onPress={() => actions.addFile(file)} />}
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
