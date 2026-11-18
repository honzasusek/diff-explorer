# Terminal UI stack

> Belongs to the parked terminal app plan ([docs/plans/cli-app.md](../plans/cli-app.md)). The Claude Code mod (ADR-0006) draws with engine elements and needs neither OpenTUI nor Bun; its facts are in [claude-code-mod.md](./claude-code-mod.md).

Verified on 2026-11-11 against the npm manifests and shipped `.d.ts` files of `@opentui/core@0.8.3` and `@opentui/react@0.8.3` (`npm pack`), and the OpenTUI docs at opentui.com, which describe 0.8.4. A safe-chain minimum-age rule hides releases newer than 0.8.3 on this machine, so 0.8.3 is what gets pinned. React 19.3.1 is already in `package.json`. The Ink 8 alternative is recorded in ADR-0005.

## Runtime

**Bun >= 1.3.14.** `@opentui/core` declares `engines: { bun: ">=1.3.14", node: ">=26.4.0" }`; the Node path needs ESM plus `--experimental-ffi`, and the docs state the React binding has no Node CI lane. This machine has Node 24.21.0 and no Bun, so Phase 0 installs Bun (`brew install oven-sh/bun/bun`). Bun runs TypeScript directly and ships a jest-compatible test runner, so `tsx` and `vitest` go.

The Agent SDK is Bun-aware: `sdk.d.ts` line 1749 declares `executable?: 'bun' | 'deno' | 'node'`, "auto-detected if not specified", and the bundle resolves it to `bun` when `process.versions.bun` is set. Claude Code therefore runs as a Bun child process with nothing to configure.

| Package | Version | Requirement | Role |
|---|---|---|---|
| `@opentui/core` | 0.8.3, pinned | Bun >= 1.3.14; native package `@opentui/core-darwin-arm64` (also darwin-x64, linux x64/arm64 glibc and musl, win32); peer `web-tree-sitter` 0.25.10 exactly | Zig renderer over FFI, Yoga layout, renderables, mouse and keyboard parsing, tree-sitter highlighting, `@opentui/core/testing` |
| `@opentui/react` | 0.8.3, pinned | React >= 19.2.0 | JSX elements `<box>`, `<text>`, `<scrollbox>`, `<diff>`, `<code>`, `<markdown>`, `<textarea>`, `<input>`; hooks; `@opentui/react/test-utils` |
| `react` | 19.3.1, present | | |
| `web-tree-sitter` | 0.25.10 | exact peer | grammar runtime |
| `bun:test` | built in | | test runner for `core/` and `tui/` |
| `util.parseArgs` | built in | | CLI argument parsing without a dependency |

tsconfig for `tui/`: `jsx: "react-jsx"`, `jsxImportSource: "@opentui/react"`, `moduleResolution: "bundler"`, types `bun`. `core/tsconfig.json` keeps `lib: ["ES2022"]`, `types: ["node"]` and no DOM; Bun implements the Node APIs core uses.

## What OpenTUI provides, from the type definitions

- **`<diff>`** (`DiffRenderable`): one file's unified-diff text in `diff`; `view: "unified" | "split"`; `filetype`; `syntaxStyle`; `wrapMode: "word" | "char" | "none"`; `showLineNumbers`; `gutter: { paddingLeft, paddingRight, minDigits }`; background and sign colours per line kind. Per-line API present in `Diff.d.ts` but not on the docs page: `setLineColor(line, color | { gutter, content })`, `setLineColors(map)`, `clearLineColor`, `clearAllLineColors`, `highlightLines(start, end, color)`, `clearHighlightLines(start, end)`, `getHunkRowOffsets(): number[]`. Multi-file input renders only the first patch, so it is one `<diff>` per File Change. It has no public scroll position and no line hit-test method.
- **`<scrollbox>`**: `scrollTop`/`scrollLeft` get and set, `scrollTo(n | { x, y })`, `scrollBy(n | { x, y } | (1, "viewport"))`, `scrollChildIntoView(child, { align: "nearest" | "start" | "end" })`, `stickyScroll` with `stickyStart: "bottom"` for a chat log, wheel scrolling by default, arrow, PageUp/Down, Home and End when focused. Viewport culling skips painting of direct children outside the viewport once there are 16 or more; Yoga still lays all of them out. Give a scrollbox `flexGrow: 1, flexBasis: 0, minHeight: 0` or it can squeeze its siblings to zero rows.
- **Mouse**: on by default (`useMouse`). Handler props on every renderable: `onMouseDown`, `onMouseUp`, `onMouseMove`, `onMouseDrag`, `onMouseDragEnd`, `onMouseDrop`, `onMouseOver`, `onMouseOut`, `onMouseScroll`, and a catch-all `onMouse`. No synthesised click: a click is `down` then `up`. `MouseEvent` carries `x`, `y` (global cells), `button` (0 left, 1 middle, 2 right), `modifiers.{shift, alt, ctrl}`, `target`, `currentTarget`, `scroll.{direction, delta}`, `preventDefault()`, `stopPropagation()`. The local row is `event.y - event.currentTarget.y`. The renderable that received the left-button `down` owns the drag until `drag-end`.
- **Text selection**: built in for text buffers (`<text>`, `<code>`, inputs; `<diff>` has `selectionBg`). `useSelectionHandler(sel => sel.getSelectedText())`, `renderer.getSelection()`, `selectable: false` to opt a renderable out.
- **Keyboard**: `useKeyboard(handler)`; `KeyEvent.name` is canonical (`"a"`, `"return"`, `"escape"`, `"tab"`) with `ctrl`, `shift`, `meta`. Global listeners run before the focused renderable; `preventDefault()` keeps a key away from the focused widget. There is no automatic Tab traversal: focus is app logic via the `focused` prop or `focus()`/`blur()`.
- **Highlighting**: tree-sitter. Bundled grammars: JavaScript/JSX, TypeScript, TSX, Markdown, Zig. Others are registered with `addDefaultParsers([{ filetype, wasm, queries: { highlights } }])` before the first client initialises; `@opentui/core/tree-sitter/update-assets` downloads a pinned `.wasm` and `highlights.scm` per grammar at build time and generates `getParsers()`. `pathToFiletype("src/main.rs")` maps a path to a filetype. A file without a grammar renders uncoloured.
- **`<markdown>`**: `content`, `syntaxStyle`, `streaming: true` while appending, set to `false` to finalise.
- **`<textarea>`**: `initialValue`, `placeholder`, `onSubmit`, `onContentChange`, `keyBindings` (default submit is Meta+Return; `{ name: "return", action: "submit" }` rebinds Enter), `plainText` getter, `setText()`.
- **Renderer**: `createCliRenderer({ exitOnCtrlC, exitSignals, targetFps, useMouse, screenMode })`, alternate screen by default; `createRoot(renderer).render(<App />)`; `renderer.destroy()` restores the terminal and is wired to SIGINT and friends unless overridden. `renderer.suspend()`/`resume()` exist for interactive child processes such as `$EDITOR`; piped children need neither. `consoleMode: "console-overlay"` is the default and captures `console.*` process-wide, so core logging goes to a file.
- **Testing**: `testRender(<App />, { width, height })` from `@opentui/react/test-utils` returns the core `TestRendererSetup`: `renderer`, `mockInput` (`pressKey`, `typeText`, `pressEnter`, `pressTab`, ...), `mockMouse` (`click`, `drag`, `scroll`, `pressDown`, `release`), `renderOnce`, `captureCharFrame`, `waitForFrame`, `resize`, `dispose`. In-memory output, no raw mode. `MockTreeSitterClient` keeps highlighting out of tests. The docs use `bun:test`.

## What OpenTUI does not do, which `tui/` builds

- **Row to line mapping in `<diff>`.** With `wrapMode: "none"` one terminal row is one diff row. `tui/diffRows.ts` maps a local row to a hunk header or `DiffLine` from the parsed File Change, cross-checked against `getHunkRowOffsets()`.
- **Line-range selection.** Gutter mouse down and drag, shift-click, and `v`/`j`/`k` all dispatch line coordinates to `selectionReducer` in core; the TUI paints the range with `highlightLines`.
- **Focus order.** `Tab` cycling and click-to-focus are app logic.
- **Child-process stdio.** `git` and the Agent SDK run with piped stdio and must never inherit the renderer's raw-mode stdin. Verified in Phase 1 (git) and Phase 4 (SDK).

## Open questions for the Phase 2 spike

1. Does a `<diff>` without an explicit `height` size itself to its row count inside a `<scrollbox>`, or must the TUI set `height` from `diffRows`? Either works; the plan assumes the latter.
2. Do `highlightLines` and `setLineColor` indexes count unified rows including hunk headers, or diff lines?
3. Does a left-button drag that starts in the gutter columns stay free of the built-in text selection? If not, mouse line selection is click and shift-click only, and drag stays reserved for copying text.
4. Repaint cost with 30 stacked `<diff>`s totalling 5000 rows: a keypress must repaint under 50 ms.
5. Which `keyBindings` action name inserts a newline, so Shift-Enter can be bound to it in the composer.
