# Claude Code mod API: facts the plan relies on

Source: the type declarations Claude Code 2.1.319 writes when the plugin-authoring skill loads (`types/claude-code.d.ts`, 23,226 lines) and the skill's `reference.md`. Verified 2026-11-18 by reading those files. The declarations are regenerated per build and are laid into `.claude-plugin/types/` of a mod the session hot-reloads, so re-read them there after an engine upgrade; `claude plugin validate` checks the module against the running build.

## Shape of a mod

- Three files: `.claude-plugin/plugin.json` (`name`, `version`, `description`, optional `types` pointing at the state contract), `hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`), and the hooks module exporting `register: Register = (on, options) => { ... }`.
- The module and every file it imports from the plugin must be `.ts`, `.tsx`, `.js` or their module variants, and are ES modules. Files are imported with plain `import` declarations; a module containing a dynamic `import()` does not load. Only the plugin's own files are loaded, so `core/` must not depend on packages.
- A hook is `($, e, next)`. `$` is the engine interface, `e` the frozen input, `next(e)` runs what is beneath and the engine's own behaviour. No DOM and no Node inside the module.
- `register(on, options)`: `options` holds the manifest's `userConfig` fields (`type` one of `string`, `number`, `boolean`, or a `string` with `options` drawn as a picker), stored under `pluginConfigs[<name>]` in settings, validated against the type with the defaults filled in. A change in `/config` reloads the module with the new object, so the hooks close over it. The kit gives a test its values with `test(name, { options }, body)`; left out, the manifest's defaults.
- JSX compiles against the global `h`; elements come from `const { Box, Text, Button, Code } = $.ui.resolve(e)`, with `e.surface` one of `terminal`, `desktop`, `vscode`, `mobile`.
- `$.state` holds session values with versions, declared in `types/index.d.ts` under `interface PluginState`; the `atom`, `read`, `update` helpers from `claude-code` make a drawing subscribe and a handler write. Values survive a hot reload; module variables do not. `$.store` keeps JSON across sessions (`get`, `set`, `delete`). `claude plugin validate` reads the atom of every `update` call in the file that makes it (a literal ref, or a const of that file), so an atom imported from another file is refused: state access stays in the hooks module and drawings take the value as an argument.
- Development: `claude --plugin-dir <folder>` loads the mod for a session and, in an interactive session, watches the folder and reloads the hooks module on save. `claude plugin validate <folder>` reads the manifest and module as the engine would; `tsc -p <folder>` type-checks against the laid types; `claude plugin test <folder>` runs `*.test.ts` files against the engine with `test`, `expect`, `mock` from `claude-code/testing`, a `ui` noun to mount components per surface and act on them by key, and a `process.run` hook the test can place beneath the plugin.

## Elements and the pane

- `Code` props: `source`, `language` (highlighter id or alias), `path` (language inferred from it; never read from disk), `startLine` (gutter numbering, ignored under diff), `format: 'source' | 'diff'`, `wrap`. Under `format: 'diff'` the source is one or more unified-diff hunks with their `@@` headers; a source that does not parse as hunks (cut mid-hunk, no `@@`) is drawn as plain code and logged. One drawing draws 100,000 characters of text across all its elements and cuts the rest with a note; a `Code` that is cut is drawn plain.
- `Button` props: `key`, `label`, `hotkey` (one digit or lowercase letter, active while the pane or band holds the keys), `plain`, `variant`, `role`, `action`, `onPress(e)`. The press argument carries `plugin`, `element`, `component`, `requestId`, `surface`; no modifier keys.
- `Input` exists on the terminal surface; `Box`, `Text`, `Button`, `Link`, `Code`, `Markdown` exist on every surface.
- The pane id `diff` is taken: a pane opened under it is drawn, and `$.ui.scroll` moves it, but the person's wheel and scroll keys never move it, although `ui.scroll` fires with the right `offset` (the engine has a site of that name and answers for it). Any other id scrolls; the mod's is `explore`.
- A pane is `$.ui.open({ id, title, focus?, rows?, columns?, closeOnEscape? })`, drawn by a `ui.render` hook on `{ component: 'Pane', requestId: id }`. The call resolves `{ isPlaced: true }` or `{ isPlaced: false, reason }`. Props: `title`, `isFocused`, `bodyColumns`, `placement: 'dock' | 'inline'` (docked beside the transcript in a fullscreen terminal from 110 columns, else inline above the prompt), `scroll: { offset, bodyRows }` (engine-owned; a move by the person or by `$.ui.scroll` asks the hook again), `view`.
- `$.ui.scroll({ in, to, block })` scrolls a keyed element or a site edge into view, like `scrollIntoView`. `$.ui.focus` moves the focus ring. `$.ui.status(text)`, `$.ui.toast(text, { timeoutMs })` (4 seconds when not given), `$.ui.invalidate`.
- `$.ui.open`'s `rows` is the body rows the pane wants while seated inline above the prompt, a request the layout may cut and a size the person dragged overrides; the dock ignores it and takes `columns` instead.
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
- A guard is registered as `on('tool.call', { tool: 'Bash' }, hook).catch(($, e, next) => (next.called ? next(e) : { deny }))`, so a hook that fails still refuses. In the kit, a plugin's `{ deny }` comes back as `deny` on the result of the test's `$.tool.call`, and a press on a mounted drawing redraws it, so a `find` right after reads the new label.
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

## Wrapping in the pane (2026-11-20)

Measured on Claude Code 2.1.329 with a throwaway mod at 71 body columns. A `Code` with `format: 'diff'` and `wrap: 'wrap'`:

- Each row opens with a prefix of `digits + 3` cells: a space, the line number right-aligned to the widest number the hunk shows, a space, the marker. A continuation row leaves the number blank and repeats the marker.
- The code wraps by character into the rest of the width, not by word. A line that fits exactly stays on one row. A wide character (CJK) takes two cells and moves whole to the next row when it does not fit.
- A tab in the line's leading run draws two cells; a later tab runs to the next multiple of eight.
- A plain `Button` takes exactly its label's width; `gap={1}` adds one cell before it.
- `Text` with `wrap: 'wrap'` wraps by word instead, which the pane does not rely on: it breaks headers itself and draws one Text per row.
- A drag across a wrapped line gives one selection row per screen row, split where the wrap fell, markers left out: the rows are not joined back into the line. `locateText` matches such a selection with row breaks and blanks dropped.

`core/diff/wrap.ts` holds the rules. On the 11,565-row hono diff every gutter number sat on the row of the engine's own number at seven scroll positions, with up to 38 wrapped rows in view. Counting rows for every line costs 35 ms, so the pane keeps the counts per hunk until the width changes; a wheel tick then redraws in 23 ms median, as before wrapping.

## Gliding the pane (2026-11-20)

A pane scrolls by whole rows and the engine has no smooth scrolling of its own. What the mod can steer, measured on Claude Code 2.1.329:

- A `ui.scroll` hook on the pane sees the person's moves and may rewrite `offset`. A page key arrives with `by` equal to `bodyRows`, End and Home with the distance to the end; a wheel tick with `by` 1 and a `pointer`. A key's `pointer` is `null` in a session, not absent as the types say.
- A plugin's own `$.ui.scroll` does not raise that plugin's `ui.scroll` hook, so a later step cannot be steered there. `to: 'start'` and `to: 'end'` go to the edges.
- `$.ui.scroll({ to: { key }, block: 'start' })` puts a keyed element's top at the window's top, but only a `Box` counts: a keyed `Text` is refused with "no element of its own is drawn under that key".

So a glide (`core/diff/glide.ts`) lands the person's jump on its first step by rewriting `offset`, then takes each later step on a timer (`$.clock.after`) as a scroll to the keyed Box at that row. The pane keys every row it draws for that: a one-row Box under each gutter button per wrapped row, a Box around each header row. On the hono diff a PageDown went 0, 16, 27, 33, 37, 38 over 176 ms; End and a chip press landed a window short at once and eased the last window in; every glide ended exactly on its target.

## Large-diff pass (2026-11-19)

Measured on Claude Code 2.1.327 with the finished pane, in the hono clone, the working tree against the merge-base with `origin/main`: 122 files, 258 hunks, 13,326 diff lines, 11,565 pane rows, a 481 KB patch. Driven in a pseudo-terminal at 160 columns (the pane docked at 71 body columns, 38 body rows), a wheel tick or a PageDown measured from the key to the first change of the pane's text.

| What | Result |
|---|---|
| `/explore . origin/main` to "Opened working tree" | 0.5 s |
| wheel tick down, 40 of them | median 27 ms, p95 68 ms, max 74 ms, none missed |
| PageDown with the pane focused, 15 | median 33 ms, max 45 ms |
| wheel tick up, 15 | median 29 ms, max 41 ms |
| the pane's own work per draw (`layoutDiff`, `hunksNear`, `renderHunk` of the window), 60 offsets | median 0.03 ms, max 0.55 ms; at most 46,000 characters drawn |
| `Workspace.diff()`, one `git diff` | 43 ms warm, 464 ms cold |
| `Workspace.diff()` forced per file (122 files) | 991 ms, about 8 ms per git call |

So a scroll costs what the engine's redraw costs, around 30 ms, and the mod's part of it is below a millisecond: the whole tree is rebuilt on every draw and that is fine. Nothing was optimised. The per-file path (`git diff --name-status -z`, then one `git diff` per file) runs only when the Runner reports the whole patch cut at the engine's 4 MiB; a file whose own patch is still cut keeps its counts from `git diff --numstat` and no hunks, and the pane header says "too large to draw". Forced on the 36-file `v5.0.0-rc.0` diff with a 10,000-character cap, four files came back so and the counts matched the whole patch's.

Also seen: `focus: true` on `$.ui.open` gives the pane the keys at once, so hotkeys work right after the command; the terminal enables SGR mouse tracking (modes 1000, 1002, 1003, 1006), which is how the engine sees drags and wheel ticks; and a merged PR's branch is usually deleted, so `gh pr checkout` fails on it (fixed in the Workspace with a `refs/pull/N/head` fetch).
