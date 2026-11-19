# Claude Code mod API: facts the plan relies on

Source: the type declarations Claude Code 2.1.319 writes when the plugin-authoring skill loads (`types/claude-code.d.ts`, 23,226 lines) and the skill's `reference.md`. Verified 2026-11-18 by reading those files. The declarations are regenerated per build and are laid into `.claude-plugin/types/` of a mod the session hot-reloads, so re-read them there after an engine upgrade; `claude plugin validate` checks the module against the running build.

## Shape of a mod

- Three files: `.claude-plugin/plugin.json` (`name`, `version`, `description`, optional `types` pointing at the state contract), `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`), and the hooks module exporting `register: Register = (on, options) => { ... }`.
- The module and every file it imports from the plugin must be `.ts`, `.tsx`, `.js` or their module variants, and are ES modules. Files are imported with plain `import` declarations; a module containing a dynamic `import()` does not load. Only the plugin's own files are loaded, so `core/` must not depend on packages.
- A hook is `($, e, next)`. `$` is the engine interface, `e` the frozen input, `next(e)` runs what is beneath and the engine's own behaviour. No DOM and no Node inside the module.
- JSX compiles against the global `h`; elements come from `const { Box, Text, Button, Code } = $.ui.resolve(e)`, with `e.surface` one of `terminal`, `desktop`, `vscode`, `mobile`.
- `$.state` holds session values with versions, declared in `types/index.d.ts` under `interface PluginState`; the `atom`, `read`, `update` helpers from `claude-code` make a drawing subscribe and a handler write. Values survive a hot reload; module variables do not. `$.store` keeps JSON across sessions (`get`, `set`, `delete`). `claude plugin validate` reads the atom of every `update` call in the file that makes it (a literal ref, or a const of that file), so an atom imported from another file is refused: state access stays in the hooks module and drawings take the value as an argument.
- Development: `claude --plugin-dir <folder>` loads the mod for a session and, in an interactive session, watches the folder and reloads the hooks module on save. `claude plugin validate <folder>` reads the manifest and module as the engine would; `tsc -p <folder>` type-checks against the laid types; `claude plugin test <folder>` runs `*.test.ts` files against the engine with `test`, `expect`, `mock` from `claude-code/testing`, a `ui` noun to mount components per surface and act on them by key, and a `process.run` hook the test can place beneath the plugin.

## Elements and the pane

- `Code` props: `source`, `language` (highlighter id or alias), `path` (language inferred from it; never read from disk), `startLine` (gutter numbering, ignored under diff), `format: 'source' | 'diff'`, `wrap`. Under `format: 'diff'` the source is one or more unified-diff hunks with their `@@` headers; a source that does not parse as hunks (cut mid-hunk, no `@@`) is drawn as plain code and logged. One drawing draws 100,000 characters of text across all its elements and cuts the rest with a note; a `Code` that is cut is drawn plain.
- `Button` props: `key`, `label`, `hotkey` (one digit or lowercase letter, active while the pane or band holds the keys), `plain`, `variant`, `role`, `action`, `onPress(e)`. The press argument carries `plugin`, `element`, `component`, `requestId`, `surface`; no modifier keys.
- `Input` exists on the terminal surface; `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown` exist on every surface.
- The pane id `diff` is taken: a pane opened under it is drawn, and `$.ui.scroll` moves it, but the person's wheel and scroll keys never move it, although `ui.scroll` fires with the right `offset` (the engine has a site of that name and answers for it). Any other id scrolls; the mod's is `explore`.
- A pane is `$.ui.open({ id, title, focus?, rows?, columns?, closeOnEscape? })`, drawn by a `ui.render` hook on `{ component: 'Pane', requestId: id }`. The call resolves `{ isPlaced: true }` or `{ isPlaced: false, reason }`. Props: `title`, `isFocused`, `bodyColumns`, `placement: 'dock' | 'inline'` (docked beside the transcript in a fullscreen terminal from 110 columns, else inline above the prompt), `scroll: { offset, bodyRows }` (engine-owned; a move by the person or by `$.ui.scroll` asks the hook again), `view`.
- `$.ui.scroll({ in, to, block })` scrolls a keyed element or a site edge into view, like `scrollIntoView`. `$.ui.focus` moves the focus ring. `$.ui.status(text)`, `$.ui.toast(text)`, `$.ui.invalidate`.
- The testing kit raises what `EventCalls` lists on `$` (`command.run`, `prompt.submit`, `tool.call`, `ui.mount` ...) and not `prompt.autocomplete`, which only the prompt box raises: a typeahead hook is checked in a session, its core function in a spec.
- `$.ui.selection()` resolves `{ text, requestId? }: the text a copy would put on the clipboard with wrapped rows joined back into lines, and the transcript row's id only when the selection lies in one row of the transcript. It is absent for a selection in a pane or the prompt.
- Band: a `ui.render` hook on `{ component: 'AbovePrompt' }` returning a tree, or `next(e)` to show nothing.

## Events used by the plan

| Event | Input | Answer |
|---|---|---|
| `session.start` | `cwd`, `surface`, `isInteractive` | register commands, restore state. There is no `session.cwd` event in this build: `$.session.cwd()` is a call that answers the directory, so a directory change shows at the next start |
| `command.run` | `command`, `args` (text after the name), `origin`, `presentation` | `{ text, exitCode? }` |
| `prompt.submit` | `text` (as typed, pastes expanded), `command?`, `isMeta?` | `next({ ...e, text })` to rewrite, `{ drop }` to stop |
| `prompt.autocomplete` | `text`, `cursor`, `token` (non-whitespace run ending at the cursor), `start`; matcher `{ token: /^#/ }` | `{ suggestions: [{ text }] }`; taking one writes `text` over the token |
| `prompt.compose` | `model`, `promptModel`, `surfaces`, `tools`, `outputStyle`, `traits` | `next(e)` gives `{ sections: [{ id, text, scope }] }`; append one with `scope: 'session'` and an id `<plugin>:<name>`. Rendered at every request and not cached, so a section whose text changes between turns loses the prompt cache; the kit raises it with the full input (`$.prompt.compose({ model, promptModel, surfaces, tools, outputStyle, traits })`) |
| `tool.call` | discriminated by `tool`; `tool_use_id`, `agentId` reserved; the tool's own arguments beside (`file_path` for Edit and Write, `notebook_path` for NotebookEdit; this build has no MultiEdit) | `await next(e)` then act on the result (`deny`, `isError`); `{ deny }` to refuse. A matcher leaf may be an array, any-of: `{ tool: ['Edit', 'Write', 'NotebookEdit'] }` |
| `ui.press`, `ui.scroll`, `ui.close`, `ui.open` | | normally handled through element closures |

## Processes and files

- `$.process.run(argv, { cwd?, env?, stdin?, timeoutMs? })` resolves `{ exitCode, stdout, stderr, isStdoutTruncated, isStderrTruncated }`. Each stream is capped at 4 MiB; the default timeout is 30 seconds, the maximum ten minutes. `$.process.spawn` for long-running children.
- `$.fs.read(path, { as })`, `write`, `list`, `exists`, `stat`; reads are bounded at 4 MiB.
- `$.session.cwd()` resolves the session's working directory.
- `$.store.get/set/delete/keys` keep JSON across sessions, 4 MiB in all; `get` answers `unknown`, so a value is checked before use. In the kit `mock.store(on, entries?)` answers it, the test's own `$` has no `store` noun, and one event takes one `on` per test: a test that wants to see the writes answers `store.get` and `store.set` itself instead of calling `mock.store`.
- `$.ui.ask(question, options)` opens the engine's AskUserQuestion dialog and resolves to the label chosen; it rejects when dismissed. It is a `tool.call` of `AskUserQuestion`, so a test answers it with a hook on `{ tool: 'AskUserQuestion' }` returning `{ result: { questions: e.questions, answers: { [question]: label } } }`.

## Limits the plan designs around

- 100,000 characters of text per drawing; a `Code` past the cut is drawn plain. The pane windows its hunks by `scroll.offset` and `bodyRows`.
- 4 MiB per process stream; a larger Diff is fetched per file.
- No modifiers on presses; no per-line hit-testing inside `Code`.
- `Input` is terminal-only; typed refs go through a command and the prompt typeahead.
- Hot reload only in an interactive session that was given the folder.

## Spike findings (2026-11-18)

Measured on Claude Code 2.1.327 with a throwaway mod that drew the hunks of honojs/hono#5541 (26 files, +2,303 −223, 82 hunks, 3,106 diff lines) in a pane, driven in a pseudo-terminal at 100, 130 and 160 columns. The script and the mod lived in the session's scratchpad; the numbers below are what they reported.

1. **One hunk per `Code` works.** A `Code format="diff"` whose source is a single `@@` hunk with no `diff --git`, `---` or `+++` lines is drawn as a diff: one row per line, a single gutter number (the old number on `-` lines, the new one elsewhere), the marker, then the code. The engine draws **no `@@` row**, so the hunk header row is the mod's own, and a hunk takes exactly `lines.length` rows.
2. **Gutter buttons align.** A column `Box` of one-row `plain` `Button`s beside a `Code` with `wrap: 'truncate-end'` lines up row for row; a click on the label `3` pressed the button with index 2. A `plain` Button draws its label alone, padding kept.
3. **`$.ui.selection().text` is the code only.** A drag inside a diff `Code`, started on the gutter or mid-line, answers the selected lines' content joined with newlines: no gutter numbers, no `+`/`-` markers, the line's own leading whitespace kept. `requestId` is absent for a pane. So `locate` matches by content. Checked again with the mod's own gutter column of `Button`s beside the `Code` (2026-11-19): a drag that starts on those buttons still answers the code alone. A row the `Code` cut under `wrap: 'truncate-end'` comes as shown, the visible text and the `…`, with nothing after the cut, so `locate` takes a row ending in `…` as a prefix of its line.
4. **The budget needs windowing.** The 82 hunks come to 115,296 characters (36 per row on average, the largest hunk 24,083, the largest file patch 50,529, the longest line 322), over the 100,000 a drawing may hold. Drawing the hunks inside `offset − 2 × bodyRows .. offset + 3 × bodyRows` and a sized placeholder for the rest came to 3,443 characters at the top and at most 22,199 characters per drawing while jumping around, with no visible gap: the engine asks for a new drawing on every wheel tick (`ui.scroll`, `by: 1`, origin `person`) and the window follows.
5. **Scroll-to-key works on a placeholder.** `$.ui.scroll({ in, to: { key }, block: 'start' })` resolved `{}` and moved the window to a keyed `Box` that stood in for an undrawn hunk; the drawing that followed put the real hunk on the same rows. This holds only while the tree's row count is exact: every header `Text` is `wrap: 'truncate-end'` (one row), and a placeholder `Box` has `height` equal to the rows it replaces. With that, `contentRows` equalled the mod's own count (3,264) at every scroll.
6. **Where the pane sits.** In a fullscreen terminal: 100 columns → `inline` above the prompt, `bodyColumns` 96, `bodyRows` 11 of 40 (a third, less the frame); 130 columns → `dock`, `bodyColumns` 57, the transcript 72 wide, `bodyRows` 33 of 40; 160 columns → `dock`, `bodyColumns` 71, the transcript 88, `bodyRows` 38 of 45. A `columns` request on `$.ui.open` is capped at 45% of the terminal, so asking for more than that gives the cap. `e.viewport.columns` is the transcript's width, not the terminal's; `presentation.columns` on `command.run` is the terminal's.

Also seen: `focus: true` on `$.ui.open` gives the pane the keys at once, so hotkeys work right after the command; the terminal enables SGR mouse tracking (modes 1000, 1002, 1003, 1006), which is how the engine sees drags and wheel ticks; and a merged PR's branch is usually deleted, so `gh pr checkout` fails on it (fixed in the Workspace with a `refs/pull/N/head` fetch).
