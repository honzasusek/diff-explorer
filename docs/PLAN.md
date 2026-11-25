# Diff Explorer: implementation plan (Claude Code mod)

Vocabulary: [GLOSSARY.md](../GLOSSARY.md). Decisions: [docs/adr](./adr), this plan rests on ADR-0006. Mod API facts: [docs/research/claude-code-mod.md](./research/claude-code-mod.md). The earlier standalone terminal app plan is parked, intact, at [docs/plans/cli-app.md](./plans/cli-app.md) with its own research notes and ADR-0005; it is the fallback if the mod turns out to be lacking. Design language (module, interface, seam, adapter, depth) follows the codebase-design skill.

## 1. Goal and scope

**v1 is a Claude Code mod**: a plugin whose hooks module adds a diff pane, a Code Ref Basket and a few slash commands to an ordinary Claude Code session. The reviewer starts Claude Code in the repository, runs `/explore 412`, reads the Diff in a pane docked beside the transcript, picks lines into Code Refs, and asks about them in the normal prompt. Claude answers in the transcript with its own tools, permissions, cost tracking and session resume. When Claude edits a file the pane refreshes and Dirty Files are marked; any Dirty File can be reverted.

**Everything the product knows lives in `core/`**, plain TypeScript with no dependency on the engine, Node or a UI, so the same code can back the parked terminal app or a web layer later (ADR-0004, appendix A).

**v1 does not:** post review comments to GitHub, commit or push, show a split view, open a repository other than the session's working directory, or ship a standalone app. It runs wherever Claude Code runs (terminal, desktop app, VS Code) with the reviewer's `gh` and Claude logins.

## 2. User story

```
$ cd ~/work/some-repo && claude
> /explore 412
```

The mod checks the PR branch out in place (`gh pr checkout`), computes the Diff against the merge-base, and opens the pane. The status line shows fetching, checking out, diffing. From 110 columns in a fullscreen terminal the pane docks beside the transcript; narrower, it sits above the prompt.

```
┌ claude ──────────────────────────────────┬ diff · PR #412 · 6 files ────────────────────┐
│ > /explore 412                                │ ▸ src/payments/client.ts  M +61 −12  [+file] │
│ Checked out feature/retry (6 files,      │   @@ -40,7 +40,22 @@ charge()        [+hunk] │
│ +184 −37 against main)                   │   40  40    const res = await fetch(url…     │
│                                          │   41     -  if (!res.ok) throw new Error(    │
│ > why is this retry safe?                │ ▌    41 +  if (!res.ok && retryable(res)) {  │
│                                          │ ▌    42 +    return retry(() => charge(url…  │
│ It is safe only for idempotent requests… │ ▌    43 +  }                                 │
│                                          │       44 +  return res.json();               │
├──────────────────────────────────────────┤   src/payments/retry.ts   A +88  −0  [+file] │
│ refs: client.ts:41-43 [x]   [add selection]                                             │
│ > add a max of 3 attempts_               │                                              │
└──────────────────────────────────────────┴──────────────────────────────────────────────┘
```

1. **Read.** The wheel scrolls the pane; `ctrl+x tab` or a click gives it the keyboard, then arrows, PageUp and PageDown scroll it. Each File Change has a header with status, counts and a fold toggle; files over a size threshold start folded. The transcript stays the normal Claude Code transcript.
2. **Select.** Three ways, detailed in 4.5: drag across lines in the pane (ordinary terminal text selection) and press `[add selection]` or type `/add`; click a first and a last line number in the gutter; or type `#client.ts:41-43` in the prompt, with typeahead after `#`. `[+hunk]` and `[+file]` take a whole Hunk or File Change. Each Code Ref appears as a chip in the band above the prompt; `[x]` drops it; pressing a chip scrolls the pane to its lines.
3. **Ask.** Type in the normal prompt and press Enter. The mod appends the Basket as `code_ref` blocks to the message, so Claude sees the quoted lines with numbers and markers. The Basket empties after sending. The reply, tool calls, permission prompts and cost are Claude Code's own.
4. **Edit.** Ask for a change; Claude's Edit asks for permission as it always does. After each Edit or Write the Diff is recomputed, the file gets a dirty marker in the pane, and any chip whose lines no longer match is marked stale. `/revert <path>` restores a Dirty File after a confirmation.
5. **Come back.** `claude --resume` brings the Conversation back. `/explore` with no argument reopens the last target opened in this repository and recomputes the Diff; a new process cannot tell a resume from a fresh start, so the pane does not open unasked.

## 3. What already exists

| Path | State | Plan |
|---|---|---|
| `package.json` | Hono + Vite + React 19 + Agent SDK + highlight.js + react-markdown; scripts point at files that do not exist. | Drop every runtime dependency: the engine loads the module and the pane is drawn by the engine, so the mod needs no packages. Keep `typescript` and `@types/node` for type-checking and core tests. Scripts: `test` runs `node --test`, `check` runs `claude plugin validate .` and `tsc -p .`. |
| `shared/types.ts` | `Diff`/`DiffFile`/`Hunk`/`DiffLine`, `WorkspaceInfo`, `PRMeta`, `CodeRef`, chat types, `MODELS`. | Move to `core/types.ts`; drop the chat types and `MODELS` (the transcript is Claude Code's). |
| `shared/chatReducer.ts` | `applyChatEvent`, pure. | Delete. It belongs to the parked plan and stays recoverable from the scaffold commit. |
| `server/diffParser.ts` | `parseUnifiedDiff`, `buildDiff`. | Move to `core/diff/parser.ts`; fixture tests; sibling `patchRenderer.ts` (4.4). |
| `server/exec.ts` | `exec` over `child_process.execFile`. | Becomes `node/runner.ts`, the Node adapter of the Runner port (4.2), used by core tests. |
| `server/tsconfig.json` | `lib: ES2022`, no DOM. | Becomes `core/tsconfig.json`, plus `types: []` and `erasableSyntaxOnly` so Node runs the tests without a build step. |
| `web/`, `vite.config.ts`, `tsconfig.json` | Web scaffold. | Delete `web/` and the Vite config. The root `tsconfig.json` is rewritten for the mod (the engine writes a base it extends). |
| git | Not initialised. | `git init`, commit the scaffold first. |

## 4. Architecture

```
 Claude Code session: terminal, desktop app, VS Code
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ transcript · prompt box · permissions · tools · cost · resume · panes   │  engine
 └────────────────▲───────────────────────────────────▲────────────────────┘
          events ($, e, next)                 $.ui  $.process  $.fs  $.state  $.store
 ┌────────────────┴───────────────────────────────────┴────────────────────┐
 │ hooks/  (the mod: event wiring and drawing; deliberately shallow)       │
 │   register.tsx   commands.ts   pane.tsx   band.tsx   state.ts   runner.ts│
 └────────────────┬────────────────────────────────────────────────────────┘
                  │ plain imports, JSON in and out
 ┌────────────────▼────────────────────────────────────────────────────────┐
 │ core/  (no engine, no Node, no DOM, no packages)                        │
 │   workspace/  Workspace over the Runner port (git, gh)                  │
 │   diff/       parser  patchRenderer  locate  selection  refs            │
 │   basket/     basketReducer  (add, remove, clear, stale marking)        │
 │   types.ts                                                              │
 └─────────────────────────────────────────────────────────────────────────┘
```

One deep module carries the product: **Workspace**. The Reviewer module of the parked plan is gone; Claude Code is the reviewer, and the two things the mod adds to a Turn (the review context section and the rendered Code Refs) are two small hooks over pure core functions. The mod layer renders state and maps commands and presses to core calls; it holds no logic that a test would want to reach past the engine.

### 4.1 The core rule

Every interface in `core/` takes and returns JSON-serialisable values. Nothing in `core/` imports `claude-code`, a Node built-in, a package or the DOM; the only way out is the Runner port, which the caller supplies.

Why: the engine loads the hooks module and every file it imports, and bundles nothing else, so a core that needs packages would not load. A core that needs no engine runs under `node --test` with no harness, backs the parked terminal app unchanged, and sits behind a web layer later. The seam is kept honest by shape, enforced by `core/tsconfig.json` (`lib: ["ES2022"]`, `types: []`) and one test that greps `core/` for `import` lines naming `claude-code`, `node:`, or a bare package.

### 4.2 Workspace (`core/workspace/`)

Interface:

```ts
createWorkspace(runner: Runner, cwd: string, opened?: WorkspaceInfo): Workspace   // `opened` resumes after a reload

open(target: Target, opts?: { baseRef?: string }): Promise<WorkspaceInfo>
diff(): Promise<Diff>                                   // always fresh, dirty flags set
revert(path: string): Promise<void>                     // Dirty Files only
```

What a caller must know beyond the signatures:

- `cwd` is the session's working directory and must be inside a git repository with a GitHub remote for PR targets. `target` is the parsed form (`core/workspace/target.ts`) of a PR number, PR URL, `owner/repo#n` of that repository, a branch name, or `.` for the working tree against `baseRef`. `fileContent` from the earlier plan is gone: nothing in v1 reads a whole file.
- `open` of a PR checks the PR branch out in place. It refuses with `DirtyCheckout` when the working tree has uncommitted changes and a different branch is checked out; reopening the PR that is already checked out fetches and fast-forwards.
- Base is `git merge-base origin/<baseRefName> HEAD` after a fetch; for `.` it is the merge-base of `baseRef` (default `origin/HEAD`, then `main`, then `master`) and HEAD.
- `diff` compares the working tree to Base, so Edits and uncommitted work are always included; untracked files are synthesised as added File Changes. Never cached.
- Errors: `NotAGitRepo`, `NoGitHubRemote`, `GhNotAuthenticated`, `TargetNotFound`, `DirtyCheckout`.

What it hides: `gh pr view --json`, `gh pr checkout`, fetch and merge-base resolution, the `git diff` flags, untracked-file synthesis, `git status --porcelain` for dirty detection, the 4 MiB output cap of `$.process.run` (a Diff larger than that is fetched per file with `git diff <base> -- <path>`).

Dependencies and seams:

- **Runner**: the one port. `Runner { run(argv: string[], opts?: { cwd?: string; stdin?: string; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }> }`. Two adapters, so the seam is real: `hooks/runner.ts` over `$.process.run`, and `node/runner.ts` over `child_process` for tests and the parked app (outside `core/`, which may not import Node).
- **Git and gh**: run for real in the test suite against a throwaway repository built by a fixture script; `gh` calls go through a scripted Runner fake that answers `gh pr view` with canned JSON. One opt-in test hits real `gh` when `DIFF_EXPLORER_E2E=1`.

### 4.3 Pure diff logic (`core/diff/`)

- `parser.ts` (exists): unified diff text to `DiffFile[]`.
- `patchRenderer.ts`: `renderHunk(file, hunk): string` (the `@@` header and its lines, which is what the pane feeds to `Code format="diff"`) and `renderPatch(file): string`. Round-trip tested: `parseUnifiedDiff(renderPatch(f))` equals `f`.
- `locate.ts`: `locateText(diff, text, hint?: { file })` answers `located`, `ambiguous` or `notFound`. Maps the text of a terminal selection back to rows of one hunk by content, since the engine hands the lines' content alone (research note, finding 3): middle rows must equal lines, the first row may end a line and the last may start one, because a drag begins and ends mid-line. When the run exists in several places the hinted file wins; otherwise the candidates are listed.
- `selection.ts`: `gutterPress(anchor, row)` says what a press on a line number does (anchor, clear, or a completed range of rows of one hunk), where `row` is `{ file, hunk, row }`; `captureRows(file, hunk, from, to)`, `captureRef(diff, { file, side, from, to })`, `captureHunk(file, hunkIndex)` and `captureFile(file)` all return a `CodeRef`, whose lines are the rows as drawn (a new-Side ref keeps the deleted lines between its kept ones). Device-neutral, shared with the parked app and a web layer.
- `refs.ts`: `renderRefs(refs): string` (the `code_ref` blocks below), `parseRefToken(token, diff): CodeRef | undefined` for `#path:from-to`, `refLabel(ref)` for chips, `suggestRefs(diff, token): string[]` for the typeahead.

```
<code_ref id="r1" file="src/api/users.ts" side="new" lines="42-57">
42  | export async function getUser(id: string) {
43 +|   const cached = cache.get(id);
</code_ref>
```

A `new`-side ref holds add and context lines numbered on the new Side; an `old`-side ref holds del and context lines numbered on the old Side. Chip label: `users.ts:42-57`.

- `basket/basketReducer.ts`: `add` (deduplicated by file, side and range), `remove`, `clear`, and `markStale(basket, diff)` which compares each ref's captured lines with the current Diff (ADR-0003).

### 4.4 The mod (`hooks/`)

| File | Interface it offers the rest of the mod | Hides |
|---|---|---|
| `register.tsx` | `export const register: Register` | which event is hooked with which matcher; nothing else |
| `state.ts` | the pane id and the module-level `diff` cache | The atoms (`review` with the target, `WorkspaceInfo`, the file list and folds; `basket` and `anchor`; a Stale Ref is computed when the band draws, from the Basket and the Diff) live in `register.tsx`: the validator reads every `update`'s atom in the file that calls it, so an atom is not imported from elsewhere. `$.state` keys are declared in `types/index.d.ts`; the Diff itself stays in a module variable and is recomputed on load because the state store is for small values |
| `runner.ts` | `Runner` over `$.process.run` | `cwd` from `$.session.cwd()`, `timeoutMs` for fetches, mapping of exit codes to Workspace errors |
| `commands.ts` | `runAdd`, `runRef`, `runRefs`: the words of `/add`, `/ref` and `/refs`, over the open Diff and a basket port the hook passes in | argument parsing and the transcript wording; the atoms stay in `register.tsx` (validator rule), as does `/explore` |
| `pane.tsx` | `renderPane($, e, review, actions)`, called by the `ui.render` hook for `{ component: 'Pane', requestId: 'explore' }` in `register.tsx` | the tree in 4.5 over `core/diff/layout.ts`; windowing by `scroll.offset` and `bodyRows`; the 100,000-character budget per drawing; presses go back through `actions` (`toggleFold`, `pressGutter`, `addHunk`, `addFile`) so the file only draws |
| `band.tsx` | `ui.render` for `{ component: 'AbovePrompt' }` | chips, `[add selection]`, `[clear]`; `next(e)` when there is nothing to show |
| `types/index.d.ts` | the `PluginState` contract | |

Events, each a one-line hook over a core call:

| Event | Matcher | Does |
|---|---|---|
| `session.start` | | registers the commands; a review kept in `$.state` from before a reload comes back (pane reopened, Diff recomputed) unless the session now runs outside its checkout, which drops it. This build raises no event for a directory change, so the start is where it shows. `$.store` serves `/explore` with no argument only: a new process cannot tell a resume from a fresh start, so no pane opens unasked |
| `command.run` | each command | 4.6 |
| `ui.render` | `Pane`, `requestId: 'explore'` | draws the pane |
| `ui.render` | `AbovePrompt` | draws the Basket band |
| `ui.press` | handled by `onPress` closures | `[+file]`, `[+hunk]`, gutter numbers, chips, `[x]`, `[add selection]` |
| `prompt.autocomplete` | `token: /^#/` | `suggestRefs` over the current Diff |
| `prompt.submit` | | appends a lead-in ("Selected in the diff pane, the lines this request is about:") and `renderRefs` of the Basket and of the `#path:from-to` tokens in the text to `e.text`, then clears the Basket once `next` resolves without a drop; a slash command's line and a hidden prompt pass untouched. The lead-in and the matching sentence in the `prompt.compose` section make the selected lines the scope of a request unless it names a wider one: "change all mentions of X" with a ref changes them in those lines, not across the repository |
| `prompt.compose` | | appends one `session` section (`core/prompt/reviewSection.ts`): the target and title, head against base, the base commit for `git diff`, the file list as paths and statuses, how `code_ref` blocks are formatted, never commit or push. No counts or dirty marks: the engine renders the prompt every turn and a changed section loses the prompt cache, so the text holds still across Edits |
| `tool.call` | `tool: 'Bash'` | refuses a `git commit` with the reason while the auto-commit switch is off; the registration's `.catch` keeps the refusal when the hook itself fails |
| `tool.call` | `tool: ['Edit', 'Write', 'NotebookEdit']` (this build has no MultiEdit) | `await next(e)`; when the call was answered and the file lies in the checkout, `workspace.diff()` again. The dirty marks follow from the file list and the stale marks from `markStale` when the band draws; a sent prompt marks a Stale Ref's block `stale="true"` |
| `ui.close` | `id: 'explore'` | keeps the review in state so `/explore` reopens it |

### 4.5 The pane and line selection

Tree, top to bottom, all engine elements (`Box`, `Text`, `Button`, `Code`):

- The head row names the target and holds the auto-commit switch, `auto-commit: on` or `auto-commit: off`: whether Claude may commit in this checkout. It sets the last sentence of the `prompt.compose` section and, while off, a `tool.call` guard on Bash refuses a `git commit` (`core/workspace/gitCommand.ts`). Off at first for a PR target, whose branch is someone else's, on for the person's own tree or branch; the setting is remembered per repository in the store with the target. Pushing and opening pull requests are never allowed unasked, whatever the switch says.
- Beside it, the side-by-side switch, `side-by-side: on` or `off`, a `view` atom kept in the store across sessions and repositories. On, each hunk is cut into blocks (`core/diff/split.ts`): unchanged lines drawn on both sides, and each run of deleted lines beside the added lines after it, the shorter side padded so the next block starts level. Each side of a block is its own diff `Code`, numbered with that side's numbers, with its own gutter; the layout counts a block as tall as its taller side. A narrow pane puts both switches under the head. A drag stays inside the `Code` it starts in (seen in a session, 2026-11-20), so side by side it selects within one block; gutter presses pick a range across blocks.
- Once the window has scrolled, a sticky head stands in for the head at the window's top: the head text, cut to fit, how many of the files with hunks are folded (`1/3 folded`), and the two switches, beside it or under it as in the head proper. It is a Box drawn `position: "absolute"` at `top = scroll.offset`, every cell written (gaps as spaces) so the diff beneath does not show through, and out of the flow so the layout's row count does not move. Its switches press as the head's do (seen in a session, 2026-11-24). At the top, and while the tree fits, it is not drawn.
- Every surface but the terminal draws the pane with `hooks/paneRich.tsx`. The terminal's pane counts character rows, which a pixel surface does not keep: in the desktop app the gutter drifted from the code, hunks overlapped, and the sticky head landed on the diff (screenshot, 2026-11-25). There the desktop's diff `Code` is a card with its own header and padding, so no gutter beside it can line up. So each diff line is one row: a gutter Button with its numbers (old and new; side by side, that side's) beside the line's text in `mono`, on the `diffAdded` or `diffRemoved` tint. Side by side, a row holds both halves, each 50% wide, so the sides stay level. No heights, no scroll window and no sticky head: the head scrolls away, and the hunks are drawn in order until BUDGET characters are spent. The syntax colours are lost, since only `Code` draws them.
- Per File Change, a header `Box` keyed by path: status, path, counts, dirty dot, `[+file]` (every line of the file: `Workspace.wholeFile` fetches the file's diff with all of it as context, `captureFile(whole, { whole: true })` makes the ref, and `core/basket/wholeFile.ts` says when it is stale), `[fold]`. There is no separate file list; the headers are the overview, and a chip scrolls the pane to its lines via `$.ui.scroll({ in: 'explore', to: <key> })`.
- Per Hunk, a header row with the `@@` text and `[+hunk]` (`captureHunk`), then a `Code` with `format: 'diff'`, `source: renderHunk(hunk)`, `path: file.path`, `wrap: 'truncate-end'`, and beside it a column of `plain` `Button`s, one per row, labelled with the line number. The engine draws no `@@` row of its own, so a hunk takes exactly one row per line and the spike showed the column aligns row for row (research note, finding 2).
- Files over the fold threshold (default 1,500 changed lines) start folded. The hook renders the hunks whose rows fall inside `scroll.offset − 2 × bodyRows .. + 3 × bodyRows` and, for the rest, a keyed `Box` whose `height` is the hunk's row count, so the tree's rows never change, `$.ui.scroll` to a key lands exactly even on an undrawn hunk, and a drawing stays under 100,000 characters for any PR size (the spike's 3,100-line PR drew at most 22,000). Long lines wrap: the `Code` has `wrap: 'wrap'`, `core/diff/wrap.ts` counts each line's rows by the engine's rule, and each gutter button sits in a Box as tall as its line; headers are broken into rows by the pane, one `Text` each, so the count stays exact. The engine asks again on every scroll, so the window follows the reader.
- A drag's `$.ui.selection().text` is the code only, without gutter numbers or markers, so `locate` matches by content.

Selection, from the reviewer's side:

| Gesture | Result |
|---|---|
| drag across lines in the pane, then `[add selection]` or `/add` | `$.ui.selection()` gives the copied text; `locateText` maps it to lines; `captureRef` adds a chip. `Ambiguous` shows a toast naming the candidates and asks for `/ref` |
| click a line number, then another | first press sets `anchor`, second press `extend`s and captures at once; pressing the anchor again clears. No shift-click and no drag ranges: presses carry no modifiers |
| `[+hunk]`, `[+file]` | one press |
| `#cli` in the prompt | typeahead offers `#src/payments/client.ts`, then `#src/payments/client.ts:40-43` per hunk; `#client.ts:41-43` typed by hand also works; `prompt.submit` appends the token's `code_ref` block after the prompt, the token staying as written so the sentence still reads |
| press a chip | `$.ui.scroll` to the hunk that holds the ref |
| `[x]` on a chip | removes it |

What the engine gives for free and the mod must not reimplement: wheel and key scrolling of the pane, `ctrl+x tab` and click to focus, Tab walking of buttons, `Esc`, docking from 110 columns, closing the pane, text selection and copy.

### 4.6 Commands

```
/explore <number | url | owner/repo#n | branch> [base]   open the PR or branch; with no argument, the last target opened in this repository
/explore . [base]                                        working tree against base (default origin/HEAD, then main, then master)
/add                                              add the current terminal selection to the Basket
/ref path:from-to [old]                           add a typed range
/refs                                             list the Basket in the transcript
/refs clear                                       empty the Basket
/revert path                                      restore a Dirty File, after confirmation
```

Names Claude Code already ships (`/pr`, `/diff`, `/review`, `/clear`) are refused at registration, which `claude plugin validate` reports, hence `/explore` and `/refs clear`. `/explore` reports in the transcript ("Checked out feature/retry, 6 files, +184 −37 against main") and updates the status line while running. A Workspace error answers in the transcript with its message and a hint (`core/workspace/errors.ts`: start inside the repository, `gh auth login`, commit or stash first), and the pane's status line shows it; a refresh that fails after an Edit or at a session start, where no command answers, says the same in a toast.

### 4.6a Options

`register(on, options)` receives the manifest's `userConfig` fields with the defaults filled in, and `core/config.ts` reads them once per load into a `Config` the hooks close over; a change in `/config` reloads the module. `baseRef` is what `/explore .` and `/explore <branch>` measure from when nothing is typed after the target (a pull request keeps its own base branch); `foldLines` is the fold threshold; `inlineRows` the body rows the pane asks for while it sits above the prompt (the dock ignores it). A value that cannot be used falls back to its default, so a hook never sees a bad one.

### 4.7 Surfaces

`Box`, `Text`, `Button`, `Code` and `Markdown` exist on every surface; `Input` does not, which is why typed refs are a slash command and typeahead rather than a field in the pane. The pane is tested on `terminal` and `desktop` through the plugin test kit.

## 5. Testing strategy

Two runners, each at its seam: core tests are `*.spec.ts` under `node --test`, mod tests are `*.test.ts` because `claude plugin test` runs every file of that name under the folder. Following the tdd skill: write the test at the module's interface first.

| Module | Runner | Test surface | Fixtures |
|---|---|---|---|
| `parser` | `node --test` | `parseUnifiedDiff` | `.diff` files: rename, copy, binary, no-newline, quoted unicode path, multiple hunks, empty file |
| `patchRenderer` | `node --test` | `renderHunk`, `renderPatch` round-trip | the same fixtures |
| `locate` | `node --test` | `locateText` | selections with and without gutter prefixes, partial edge rows, text present in two files, text absent |
| `selection`, `refs`, `basket` | `node --test` | reducers and pure functions | synthetic `Diff`; every `suggestRefs` suggestion parses with `parseRefToken` |
| `Workspace` | `node --test` | `open`/`diff`/`fileContent`/`revert` with `nodeRunner` on a temp repository | fixture script: base commit, feature branch, committed change, uncommitted edit, untracked file, rename, binary; scripted `gh` answers |
| core boundary | `node --test` | grep | fails on an import of `claude-code`, `node:` or a package inside `core/` |
| commands | `claude plugin test` | `command.run` with a `process.run` hook beneath that answers canned git and gh output | state holds the review; the transcript text names the branch and counts |
| pane and band | `claude plugin test` | mount `Pane` and `AbovePrompt` on `terminal` and `desktop`; `find` file names; `press` `[+hunk]`; assert the Basket | small Diff |
| prompt hooks | `claude plugin test` | `prompt.submit` with a Basket yields text containing a `code_ref` block and empties the Basket; `prompt.autocomplete` with `#cli` suggests `#client.ts` | small Diff |

`claude plugin validate .` and `tsc -p .` run in `npm run check`. Replace, don't layer: once `Workspace` has interface tests there are no separate tests for its git helpers.

## 6. Phases and commits

Each bullet that ends with a commit message is one local commit, made as soon as that feature is verified. Nothing is pushed.

### Phase 0: foundation (half a day)

- `git init`, commit the existing scaffold as-is. `chore: scaffold server, web and shared types`
- Restructure into `core/` and `hooks/`; add `.claude-plugin/plugin.json`, `hooks/hooks.json`, `types/index.d.ts`; drop the web dependencies; `node --test` with `erasableSyntaxOnly`; the boundary test. `chore: restructure as a claude code mod with a pure core`
- Docs: glossary, ADRs 0001 to 0006, research notes, this plan, the parked plan. `docs: mod plan, adr-0006 and parked cli plan`
- Hello mod: `/explore` registers, opens an empty pane titled `diff`, and the band shows "no refs". `claude plugin validate .` passes, `tsc -p .` passes, and the mod loads in a session started with `claude --plugin-dir .` and hot-reloads on save. `feat: mod skeleton with pane and band`

### Phase 1: Workspace (1 day)

- Parser fixture tests, fix what they find; `patchRenderer` with the round-trip test. `test: diff parser fixtures and patch renderer`
- Runner port with the Node adapter; Workspace for `.` and branch targets: merge-base, diff with dirty flags and untracked synthesis, revert; PR targets through `gh` with the error cases and a scripted `gh` fake; temp-repository tests. `feat: workspace over a runner port, with pull requests via gh`
- `hooks/runner.ts`, `/explore` filling state, status line while running, file list with counts in the pane. `feat: open a pr from the session`

### Phase 2: diff pane (1 day)

- Spike, throwaway, half a day, on a real 3,000-line PR: answers the open questions in the research note (one hunk per `Code`, the 100,000-character budget and windowing by scroll, gutter button alignment, the shape of `$.ui.selection().text`, dock behaviour at 100 and 130 columns, `$.ui.scroll` to a keyed `Box`). Findings go into the research note. `docs: mod spike findings`
- The pane proper: per-hunk `Code`, file headers with dirty dots, folding, windowing. `feat: diff pane`

### Phase 3: Code Refs (1 day)

- `selection`, `refs`, `basket` in core, tests first. `feat: selection, refs and basket model`
- `locate` with tests; `/add` and `[add selection]`; `[+hunk]` and `[+file]`; gutter buttons if the spike said yes. `feat: add selected lines to the basket`
- Band with chips, `[x]`, scroll-to on press; `prompt.submit` appends the refs and clears the Basket; `/ref`, `/refs`, `/refs clear`. `feat: basket band and code refs in prompts`
- `prompt.autocomplete` for `#path` and `#path:from-to`. `feat: ref typeahead in the prompt`

### Phase 4: edits and context (half a day)

- `prompt.compose` review section. `feat: review context in the system prompt`
- `tool.call` refresh after Edit and Write, stale marking, `/revert` with confirmation, `session.cwd`, `$.store` for `/explore` with no argument and for reopening on `session.start`. `feat: reflect claude edits in the diff`

### Phase 5: polish (half a day to 1 day)

- `userConfig`: default base ref, fold threshold, pane rows when inline. Error toasts for every Workspace error. `feat: config and error toasts`
- README with the install line and a `.claude-plugin/marketplace.json`; tests green on `terminal` and `desktop`. `docs: readme and marketplace manifest`
- Large-PR pass: a 5,000-row Diff must scroll without visible lag; measure the per-file diff path. One commit. `perf: large diffs scroll and a cut patch is fetched per file`

Total: four to five days, against seven for the parked plan.

### Later, not scheduled

Web layer as in appendix A. Review comments via `gh api` behind an explicit confirm. Opening a repository other than the session's (clone, then a new session there). Existing PR review comments inline. Split view is not available: `Code` draws unified only. If the mod proves lacking, the parked plan picks up `core/` as it stands.

## 7. Decisions (confirmed 2026-11-18)

1. **A Claude Code mod instead of a standalone terminal app** (ADR-0006). The CLI plan, its stack note and ADR-0005 are kept under `docs/plans/` and `docs/research/` as the fallback.
2. **The session's working directory is the Workspace.** PRs are checked out in place; the reviewer's own checkout is edited, as for local targets before (ADR-0002, amended).
3. **Line selection** is terminal text selection plus `/add`, two-click gutter buttons if the spike proves alignment, and typed refs with typeahead. No shift-click or drag ranges: the engine reports no modifiers on presses.
4. **Unified view only.** `Code format="diff"` is unified.
5. **One package with `core/` and `hooks/`**, `node --test` for core and `claude plugin test` for hooks. No Bun, no OpenTUI, no Agent SDK, no runtime packages.
6. Earlier decisions that stand: Code Refs are snapshots (ADR-0003); reads are auto-allowed and edits ask, now through Claude Code's own permission system, which the mod does not touch; Claude's model and cost are the session's.

## 8. Risks

- **The mod API is declared per build.** The types this plan was checked against come from Claude Code 2.1.319 and are regenerated on every load. `npm run check` runs `claude plugin validate`, so an engine upgrade that changes a shape fails loudly. No package to pin.
- **100,000 characters per drawing.** Windowing by `scroll.offset` and folding keep any PR under it; the spike measures a 3,000-line PR before the pane depends on it.
- **Gutter buttons may not align with `Code` rows.** Then selection is drag plus `/add`, hunk and file buttons, and typed refs, which already cover every case; the two-click path is a convenience.
- **The shape of selected text is unverified.** `locateText` handles rows with and without a gutter prefix; the spike confirms which it is.
- **Pane placement.** Docked from 110 columns in a fullscreen terminal, inline above the prompt otherwise. The dock is capped at 45% of the terminal: 57 body columns at 130, 71 at 160 (research note, finding 6), so long lines are truncated and the reader widens the dock by hand. Inline works but the pane competes with the transcript for rows; `userConfig` sets its rows.
- **`$.process.run` limits.** 4 MiB per stream and a 30-second default timeout: the Runner reports a cut stream, and a cut patch is fetched per file (a file still cut keeps its counts and is drawn as "too large"); `timeoutMs` on fetches.
- **Hot reload needs an interactive session.** Development runs `claude --plugin-dir .` in a second terminal; `claude -p` and SDK hosts load the folder without reloading.
- **Redraw cost.** The whole pane tree is rebuilt on each state change; windowing bounds it. Measured in the Phase 5 pass on an 11,565-row diff: a wheel tick redraws in about 30 ms, of which the mod's own work is under a millisecond (research note, large-diff pass).
- **No `Input` outside the terminal.** Typed refs go through the prompt, which exists everywhere.

## Appendix A: the future web layer

`core/` does not change. A web layer adds `http/` (routes over `Workspace` and the pure diff functions) and `web/` (a React app reusing `types`, `selection`, `refs` and `basket` through the bundler). The reviewer half, which the mod gets from Claude Code, would come from the Agent SDK as designed in the parked plan's Reviewer module; that design and its research note are kept for exactly that reason.
