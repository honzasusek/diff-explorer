import type { EngineInterface, RenderInput } from 'claude-code'

import type { DiffView, Review } from '../types'
import type { DiffFile, DiffLine, Hunk } from '../core/types.ts'
import type { Anchor } from '../core/diff/selection.ts'
import { renderHunkHeader } from '../core/diff/patchRenderer.ts'
import { splitHunk } from '../core/diff/split.ts'
import { BUDGET, fileHeader, foldLabel, headLine, plural, statusLine } from './pane.tsx'
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
// Nothing here is measured in rows, so the whole diff is drawn, hunk by hunk
// until BUDGET characters are spent; a hunk past it shows its header and size.

/** The number of digits of a hunk's widest line number, either side. */
function digitsOf(hunk: Hunk): number {
  return Math.max(1, ...hunk.lines.map(line => String(Math.max(line.oldNo ?? 0, line.newNo ?? 0)).length))
}

/** A number padded to `digits`, blank when absent: `pad(7, 3)` is `'  7'`. */
function pad(number: number | null, digits: number): string {
  return String(number ?? '').padStart(digits)
}

/** The marker and tint of a line: `+` on the added colour, `-` on the removed. */
function look(line: DiffLine): { mark: string; tint: 'diffAdded' | 'diffRemoved' | undefined } {
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

  /** One line's text in the monospaced face, on its tint; a blank line keeps a space so its row keeps its height. */
  const code = (line: DiffLine | undefined, key: string) => {
    if (line === undefined) return <Text key={key} mono>{' '}</Text>
    const { mark, tint } = look(line)

    return (
      <Text key={key} mono wrap="wrap" backgroundColor={tint}>
        {`${mark}${line.content === '' ? ' ' : line.content}`}
      </Text>
    )
  }

  const unified = (file: DiffFile, hunk: Hunk, index: number, anchoredRow: number) => {
    const digits = digitsOf(hunk)

    return hunk.lines.map((line, row) => (
      <Box key={`row:${file.id}:${index}:${row}`} flexDirection="row" backgroundColor={look(line).tint}>
        {gutter(file, index, row, `${pad(line.oldNo, digits)} ${pad(line.newNo, digits)}`, row === anchoredRow, `line:${file.id}:${index}:${row}`)}
        <Box flexGrow={1} flexShrink={1}>
          {code(line, `code:${file.id}:${index}:${row}`)}
        </Box>
      </Box>
    ))
  }

  const split = (file: DiffFile, hunk: Hunk, index: number, anchoredRow: number) => {
    const digits = digitsOf(hunk)
    // One side of one row: its number and text, or a blank half where the side ran out.
    const half = (row: number | undefined, which: 'old' | 'new', key: string) => {
      const line = row === undefined ? undefined : hunk.lines[row]
      if (row === undefined || line === undefined) {
        return <Box key={key} width="50%" flexShrink={0} />
      }
      const number = which === 'old' ? line.oldNo : line.newNo

      return (
        <Box key={key} width="50%" flexShrink={0} flexDirection="row" backgroundColor={look(line).tint}>
          {gutter(file, index, row, pad(number, digits), row === anchoredRow, `line:${which}:${file.id}:${index}:${row}`)}
          <Box flexGrow={1} flexShrink={1}>
            {code(line, `code:${which}:${file.id}:${index}:${row}`)}
          </Box>
        </Box>
      )
    }

    return splitHunk(hunk).flatMap((block, b) =>
      Array.from({ length: Math.max(block.left.length, block.right.length) }, (_, i) => (
        <Box key={`pair:${file.id}:${index}:${b}:${i}`} flexDirection="row">
          {half(block.left[i], 'old', `old:${file.id}:${index}:${b}:${i}`)}
          {half(block.right[i], 'new', `new:${file.id}:${index}:${b}:${i}`)}
        </Box>
      )),
    )
  }

  const sections = []
  if (diff !== null) {
    let chars = 0
    for (const file of diff.files) {
      const isFolded = folded.has(file.id)
      sections.push(
        <Box key={`file:${file.id}`} flexDirection="column" marginTop={1}>
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
          {!isFolded &&
            file.hunks.map((hunk, index) => {
              const header = renderHunkHeader(hunk)
              const size = hunk.lines.reduce((sum, line) => sum + line.content.length + 1, 0)
              const drawn = chars + size <= BUDGET
              if (drawn) chars += size
              const anchoredRow = anchor !== null && anchor.file === file.path && anchor.hunk === index ? anchor.row : -1

              return (
                <Box key={`hunk:${file.id}:${index}`} flexDirection="column" marginTop={1}>
                  <Box flexDirection="row" gap={1}>
                    <Box flexGrow={1} flexShrink={1}>
                      <Text mono dimColor>
                        {drawn ? header : `${header} · ${plural(hunk.lines.length, 'line')}, too long to draw here`}
                      </Text>
                    </Box>
                    <Button key={`hunk+:${file.id}:${index}`} plain dimColor label="+hunk" onPress={() => actions.addHunk(file, index)} />
                  </Box>
                  {drawn && (view === 'split' ? split(file, hunk, index, anchoredRow) : unified(file, hunk, index, anchoredRow))}
                </Box>
              )
            })}
        </Box>,
      )
    }
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
