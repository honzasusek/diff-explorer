# Claude Code mod API: facts the plan relies on

Source: the type declarations Claude Code 2.1.319 writes when the plugin-authoring skill loads (`types/claude-code.d.ts`, 23,226 lines) and the skill's `reference.md`. Verified 2026-11-18 by reading those files. The declarations are regenerated per build and are laid into `.claude-plugin/types/` of a mod the session hot-reloads, so re-read them there after an engine upgrade; `claude plugin validate` checks the module against the running build.

## Shape of a mod

- Three files: `.claude-plugin/plugin.json` (`name`, `version`, `description`, optional `types` pointing at the state contract), `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`), and the hooks module exporting `register: Register = (on, options) => { ... }`.
- The module and every file it imports from the plugin must be `.ts`, `.tsx`, `.js` or their module variants, and are ES modules. Files are imported with plain `import` declarations; a module containing a dynamic `import()` does not load. Only the plugin's own files are loaded, so `core/` must not depend on packages.
- A hook is `($, e, next)`. `$` is the engine interface, `e` the frozen input, `next(e)` runs what is beneath and the engine's own behaviour. No DOM and no Node inside the module.
- JSX compiles against the global `h`; elements come from `const { Box, Text, Button, Code } = $.ui.resolve(e)`, with `e.surface` one of `terminal`, `desktop`, `vscode`, `mobile`.
- `$.state` holds session values with versions, declared in `types/index.d.ts` under `interface PluginState`; the `atom`, `read`, `update` helpers from `claude-code` make a drawing subscribe and a handler write. Values survive a hot reload; module variables do not. `$.store` keeps JSON across sessions (`get`, `set`, `delete`).
- Development: `claude --plugin-dir <folder>` loads the mod for a session and, in an interactive session, watches the folder and reloads the hooks module on save. `claude plugin validate <folder>` reads the manifest and module as the engine would; `tsc -p <folder>` type-checks against the laid types; `claude plugin test <folder>` runs `*.test.ts` files against the engine with `test`, `expect`, `mock` from `claude-code/testing`, a `ui` noun to mount components per surface and act on them by key, and a `process.run` hook the test can place beneath the plugin.

## Elements and the pane

- `Code` props: `source`, `language` (highlighter id or alias), `path` (language inferred from it; never read from disk), `startLine` (gutter numbering, ignored under diff), `format: 'source' | 'diff'`, `wrap`. Under `format: 'diff'` the source is one or more unified-diff hunks with their `@@` headers; a source that does not parse as hunks (cut mid-hunk, no `@@`) is drawn as plain code and logged. One drawing draws 100,000 characters of text across all its elements and cuts the rest with a note; a `Code` that is cut is drawn plain.
- `Button` props: `key`, `label`, `hotkey` (one digit or lowercase letter, active while the pane or band holds the keys), `plain`, `variant`, `role`, `action`, `onPress(e)`. The press argument carries `plugin`, `element`, `component`, `requestId`, `surface`; no modifier keys.
- `Input` exists on the terminal surface; `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown` exist on every surface.
- A pane is `$.ui.open({ id, title, focus?, rows?, columns?, closeOnEscape? })`, drawn by a `ui.render` hook on `{ component: 'Pane', requestId: id }`. The call resolves `{ isPlaced: true }` or `{ isPlaced: false, reason }`. Props: `title`, `isFocused`, `bodyColumns`, `placement: 'dock' | 'inline'` (docked beside the transcript in a fullscreen terminal from 110 columns, else inline above the prompt), `scroll: { offset, bodyRows }` (engine-owned; a move by the person or by `$.ui.scroll` asks the hook again), `view`.
- `$.ui.scroll({ in, to, block })` scrolls a keyed element or a site edge into view, like `scrollIntoView`. `$.ui.focus` moves the focus ring. `$.ui.status(text)`, `$.ui.toast(text)`, `$.ui.invalidate`.
- `$.ui.selection()` resolves `{ text, requestId? }`: the text a copy would put on the clipboard with wrapped rows joined back into lines, and the transcript row's id only when the selection lies in one row of the transcript. It is absent for a selection in a pane or the prompt.
- Band: a `ui.render` hook on `{ component: 'AbovePrompt' }` returning a tree, or `next(e)` to show nothing.

## Events used by the plan

| Event | Input | Answer |
|---|---|---|
| `session.start`, `session.cwd` | | register commands, restore state |
| `command.run` | `command`, `args` (text after the name), `origin`, `presentation` | `{ text, exitCode? }` |
| `prompt.submit` | `text` (as typed, pastes expanded), `command?`, `isMeta?` | `next({ ...e, text })` to rewrite, `{ drop }` to stop |
| `prompt.autocomplete` | `text`, `cursor`, `token` (non-whitespace run ending at the cursor), `start`; matcher `{ token: /^#/ }` | `{ suggestions: [{ text }] }`; taking one writes `text` over the token |
| `prompt.compose` | | `next(e)` gives `{ sections: [{ id, text, scope }] }`; append one with `scope: 'session'` |
| `tool.call` | discriminated by `tool`; `tool_use_id`, `agentId` reserved; the tool's own arguments beside | `await next(e)` then act on the result; `{ deny }` to refuse |
| `ui.press`, `ui.scroll`, `ui.close`, `ui.open` | | normally handled through element closures |

## Processes and files

- `$.process.run(argv, { cwd?, env?, stdin?, timeoutMs? })` resolves `{ exitCode, stdout, stderr, isStdoutTruncated, isStderrTruncated }`. Each stream is capped at 4 MiB; the default timeout is 30 seconds, the maximum ten minutes. `$.process.spawn` for long-running children.
- `$.fs.read(path, { as })`, `write`, `list`, `exists`, `stat`; reads are bounded at 4 MiB.
- `$.session.cwd()` resolves the session's working directory.

## Limits the plan designs around

- 100,000 characters of text per drawing; a `Code` past the cut is drawn plain. The pane windows its hunks by `scroll.offset` and `bodyRows`.
- 4 MiB per process stream; a larger Diff is fetched per file.
- No modifiers on presses; no per-line hit-testing inside `Code`.
- `Input` is terminal-only; typed refs go through a command and the prompt typeahead.
- Hot reload only in an interactive session that was given the folder.

## Open questions for the Phase 2 spike

1. Does `Code format="diff"` accept a single hunk (the `@@` line plus its lines) without the `diff --git`, `---` and `+++` headers? The plan renders one `Code` per hunk.
2. Does a column of one-row `plain` `Button`s in a row `Box` beside a `Code` with `wrap: 'truncate-end'` stay aligned row for row, including the hunk header row?
3. What does `$.ui.selection().text` contain for a drag inside a `Code format="diff"`: the gutter numbers and markers too, or the code only?
4. How many characters does a 3,000-line PR come to, and does windowing to `scroll.offset ± 2 × bodyRows` keep each drawing under 100,000 with no visible gap while scrolling?
5. Does `$.ui.scroll({ in: 'diff', to: <key> })` land on a keyed `Box` inside a windowed tree whose target is not yet drawn, or must the window be moved first?
6. At 100 and at 130 columns in a fullscreen terminal: where does the pane sit and how many `bodyColumns` does it get?
