import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { DiffView, Review } from '../types'
import type { DiffFile, DiffLine, Hunk } from '../core/types.ts'
import type { Anchor } from '../core/diff/selection.ts'
import { renderHunkHeader } from '../core/diff/patchRenderer.ts'
import { splitHunk } from '../core/diff/split.ts'
import { highlightLine, isHighlighted } from '../core/diff/highlight.ts'
import type { LineState, Piece, TokenKind } from '../core/diff/highlight.ts'
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
// TypeScript is coloured by the mod (core/diff/highlight.ts), each keyword,
// string, comment or number a nested Text in its colour. Those cost an
// element each, so hunks are coloured from the top while the budget left after
// drawing them all lasts; the rest stay plain, never left out.
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

/** What one coloured stretch costs: a nested Text with its colour. Measured
 * on the test kit's tree. */
const PIECE_COST = 70

/** Colours that read on both the light and the dark theme, as the theme has
 * no keys for code. A comment is drawn dim instead, in the theme's own way. */
const COLOR: Record<Exclude<TokenKind, 'comment'>, string> = {
  keyword: '#a855f7',
  string: '#d97706',
  number: '#0891b2',
}

/** A hunk's lines as pieces, each side's open comment or template carried
 * from line to line: a removed line follows the old side, an added line the
 * new side, and a context line both. */
function piecesOf(hunk: Hunk): Piece[][] {
  let old: LineState = 'code'
  let neu: LineState = 'code'

  return hunk.lines.map(line => {
    const { pieces, state } = highlightLine(line.content, line.type === 'del' ? old : neu)
    if (line.type !== 'add') old = state
    if (line.type !== 'del') neu = state

    return pieces
  })
}

/** Coloured stretches a hunk spends: every piece that is not plain. */
function pieceCount(pieces: Piece[][]): number {
  return pieces.reduce((sum, line) => sum + line.filter(piece => piece.kind !== null).length, 0)
}

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
/** The backgrounds of changed lines: GitHub's light green and red. They are
 * paler than the theme's diffAdded and diffRemoved, so the syntax colours on
 * them stand out. */
const TINT: Record<DiffLine['type'], string | undefined> = {
  add: 'rgb(218, 251, 225)',
  del: 'rgb(255, 206, 203)',
  context: undefined,
}

/** The text colour on a tint: GitHub's dark ink. The tints are light whatever
 * the theme, so a dark theme's light text would barely show on them. */
const INK = '#1f2328'

/** One line as the unified block writes it: both numbers, the marker, the code.
 * An addition at new line 41 with two digits, `x`, is `'   41 +x'`. */
export function unifiedLine(line: DiffLine, digits: number): string {
  return unifiedPrefix(line, digits) + line.content
}

/** What the unified block writes before a line's code: both numbers and the marker. */
function unifiedPrefix(line: DiffLine, digits: number): string {
  return `${pad(line.oldNo, digits)} ${pad(line.newNo, digits)} ${MARK[line.type]}`
}

/** A line as a block draws it: the numbers and marker, then the code, coloured
 * by its pieces when the hunk is coloured. */
interface BlockLine {
  type: DiffLine['type']
  prefix: string
  content: string
  pieces?: Piece[]
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

  /** A piece in its colour: a nested Text, or the bare string when plain. */
  const paint = (piece: Piece) => {
    if (piece.kind === null) return piece.text
    if (piece.kind === 'comment') return <Text dimColor>{piece.text}</Text>

    return <Text color={COLOR[piece.kind]}>{piece.text}</Text>
  }

  /** Lines joined by newlines as a Text's children, neighbouring strings
   * merged: `[{prefix '1 ', content 'a'}, {prefix '2 ', content 'b'}]` gives
   * `['1 a\n2 b']`, and a coloured piece splits the string around it. */
  const inline = (lines: BlockLine[]) => {
    const out: Array<string | RenderElement> = []
    const add = (child: string | RenderElement) => {
      const last = out[out.length - 1]
      if (typeof child === 'string' && typeof last === 'string') out[out.length - 1] = last + child
      else if (child !== '') out.push(child)
    }
    lines.forEach((line, i) => {
      if (i > 0) add('\n')
      add(line.prefix)
      if (line.pieces === undefined) add(line.content)
      else line.pieces.forEach(piece => add(paint(piece)))
    })

    return out
  }

  /** Lines as one Text: a context run a plain string, a changed run a
   * nested Text on its tint. The newline after a tinted run stays outside
   * it, so the tint ends with the line. */
  const block = (lines: BlockLine[], key: string) => {
    const children = runs(lines.map(line => line.type)).flatMap(run => {
      const text = inline(lines.slice(run.from, run.to + 1))
      const tail = run.to < lines.length - 1 ? ['\n'] : []
      const tint = TINT[run.type]
      if (tint === undefined) return [...text, ...tail]

      return [
        <Text backgroundColor={tint} color={INK}>
          {text}
        </Text>,
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

  const unified = (hunk: Hunk, key: string, pieces: Piece[][] | undefined) => {
    const digits = digitsOf(hunk)

    return block(
      hunk.lines.map((line, i) => ({
        type: line.type,
        prefix: unifiedPrefix(line, digits),
        content: line.content,
        pieces: pieces?.[i],
      })),
      key,
    )
  }

  const split = (hunk: Hunk, key: string, pieces: Piece[][] | undefined) => {
    const digits = digitsOf(hunk)
    const side = (indexes: number[], length: number, which: 'old' | 'new'): BlockLine[] =>
      Array.from({ length }, (_, i) => {
        const at = indexes[i]
        const line = at === undefined ? undefined : hunk.lines[at]
        const text = sideLine(line, which, digits)
        const content = line?.content ?? ''

        return {
          type: line?.type ?? 'context',
          prefix: text.slice(0, text.length - content.length),
          content,
          pieces: at === undefined ? undefined : pieces?.[at],
        }
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
          <Text mono tabular color={TINT[line.type] === undefined ? undefined : INK}>
            {`${row === anchoredRow ? '▸' : ' '}${pad(line.oldNo, digits)} ${pad(line.newNo, digits)} `}
          </Text>
        </Button>
        <Text mono wrap="wrap" color={TINT[line.type] === undefined ? undefined : INK}>
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
    const drawn = new Set<string>()
    diff.files.forEach(file => {
      if (folded.has(file.id)) return
      file.hunks.forEach((hunk, index) => {
        const key = `${file.id}:${index}`
        const cost = key === picking ? 0 : textCost(hunk)
        if (key !== picking && spent + cost > WIRE_BUDGET) return
        spent += cost
        drawn.add(key)
      })
    })
    // What is left after every drawn hunk colours TypeScript hunks from the
    // top; the first that does not fit ends the colouring, so it never skips about.
    const coloured = new Map<string, Piece[][]>()
    let colouring = true
    diff.files.forEach(file => {
      if (!isHighlighted(file.path)) return
      file.hunks.forEach((hunk, index) => {
        const key = `${file.id}:${index}`
        if (!colouring || key === picking || !drawn.has(key)) return
        const pieces = piecesOf(hunk)
        const cost = pieceCount(pieces) * PIECE_COST
        if (spent + cost > WIRE_BUDGET) colouring = false
        else {
          spent += cost
          coloured.set(key, pieces)
        }
      })
    })
    diff.files.forEach((file, f) => {
      const isFolded = folded.has(file.id)
      const rows: RenderElement[] = []
      if (!isFolded) {
        file.hunks.forEach((hunk, index) => {
          const key = `${file.id}:${index}`
          const isPicking = key === picking
          const isDrawn = drawn.has(key)
          const header = renderHunkHeader(hunk)
          rows.push(
            <Box key={`h${f}.${index}`} flexDirection="column" marginTop={1}>
              <Box flexDirection="row" gap={2}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text mono dimColor>
                    {isDrawn
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
              {!isPicking &&
                isDrawn &&
                (view === 'split' ? split(hunk, `t${f}.${index}`, coloured.get(key)) : unified(hunk, `t${f}.${index}`, coloured.get(key)))}
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
