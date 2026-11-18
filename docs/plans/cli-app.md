> **Parked on 2026-11-18.** The first version ships as a Claude Code mod instead (ADR-0006, [docs/PLAN.md](../PLAN.md)). This plan is kept whole as the fallback: `core/` is shared, and only `tui/` and the Reviewer module would be built from here. Its research notes are [tui-stack.md](../research/tui-stack.md) and [claude-agent-sdk.md](../research/claude-agent-sdk.md).

# Diff Explorer: implementation plan (terminal first)

Vocabulary: [GLOSSARY.md](../GLOSSARY.md). Decisions: [docs/adr](./adr). SDK facts: [docs/research/claude-agent-sdk.md](./research/claude-agent-sdk.md). Terminal stack: [docs/research/tui-stack.md](./research/tui-stack.md). Design language (module, interface, seam, adapter, depth) follows the codebase-design skill.

## 1. Goal and scope

**v1 is a terminal app.** `diff-explorer <pr-url | owner/repo#n | path>` opens a full-screen review: the Diff rendered GitHub-style in the terminal, keyboard or mouse selection of lines into Code Refs, and a Conversation with Claude that can explain those refs or make Edits in the checkout. Edits show up in the Diff immediately, Dirty Files are marked, and any file can be reverted.

**Everything the product knows lives in `core/`**, which does not know it is driven from a terminal. A web frontend is a later, second thin layer over the same core (ADR-0004, appendix A).

**v1 does not:** post review comments to GitHub, commit or push, show a split view, or ship a web UI. It runs on the reviewer's machine on Bun, using their `gh` and Claude logins.

## 2. User story

```
$ diff-explorer https://github.com/strvcom/some-repo/pull/412
```

The first open of a repo clones it (blob-less, so fast) under `~/.diff-explorer/workspaces/`, checks the PR branch out, and computes the Diff against the merge-base. A status line shows cloning, checking out, computing diff. Then the screen switches to the alternate buffer:

```
 PR #412 Add retry to payment client  feature/retry → main  +184 −37  Opus 5.5  edits: ask   ?:help
┌ FILES 6 ─────────────┬ src/payments/client.ts  M +61 −12 ──────────────────────┬ CHAT ──────────────────────┐
│ ▸ client.ts     +61 −12│ @@ -40,7 +40,22 @@ export async function charge(        │                            │
│   retry.ts      +88  −0│  40  40    const res = await fetch(url, opts);         │ you  client.ts:41-43       │
│   types.ts       +9  −3│  41     -  if (!res.ok) throw new Error(res.status)    │   why is this retry safe,  │
│   client.test.ts+22  −0│      41 +  if (!res.ok && retryable(res)) {            │   can it double-charge?    │
│   README.md      +4  −0│      42 +    return retry(() => charge(url, opts));    │                            │
│   CHANGELOG.md   +1  −0│      43 +  }                                           │ claude                     │
│                        │      44 +  return res.json();                          │   It is safe only for      │
│                        │ @@ -58,3 +73,9 @@                                      │   idempotent requests…     │
│                        │  58  73  export function retryable(res: Response) {    │   ▸ Read src/payments/…    │
│                        │                                                        │   $0.04  3.1s              │
│                        │                                                        ├ refs: client.ts:41-43 ─────┤
│                        │                                                        │ > add a max of 3 attempts_ │
└────────────────────────┴────────────────────────────────────────────────────────┴────────────────────────────┘
 j/k move  v select  a add to chat  i ask  Tab pane  ]/[ file  e auto-edits  r refresh  q quit   wheel · click · drag gutter
```

1. **Read.** Scroll any pane with the wheel, or `Tab` between the files, diff and chat panes and use `j`/`k`, `Ctrl-d`/`Ctrl-u`, `g`/`G`. `]`/`[` or a click in the files pane jumps to a file. Files over 1500 changed lines start collapsed; `Enter` or a click on a file header expands it. `x` on a hunk header, or a click on its `⋯` row, expands context.
2. **Select.** Click a line number to put the cursor there and start a Selection; drag down the gutter or shift-click another line number to extend it, exactly like GitHub. From the keyboard, `v` starts a Selection at the cursor and `j`/`k` extend it; `Esc` clears. `a` adds the Selection to the Basket, or the current hunk when nothing is selected; `A` adds the whole file's changes. The Basket shows as chips above the composer. Dragging across the code text itself selects text for copying, as in any terminal.
3. **Ask.** `i` or a click focuses the composer, type, `Enter` sends with the Basket attached (`Shift-Enter` for a newline). Claude's answer streams in as rendered markdown; tool calls show as one-line collapsed entries that `Enter` or a click expands. `o` on a ref chip, or a click on it, jumps the diff to those lines. Each answer ends with cost and duration.
4. **Edit.** Ask for a change. When Claude wants to edit a file, a permission card appears in the chat with the path and a preview; `y` or clicking `[allow]` allows, `n` or `[deny]` denies. `e` toggles auto-accept edits for the session. When the Turn finishes the Diff refreshes, edited files get a dirty marker, and `R` on a Dirty File reverts it after a confirmation. `d` toggles an edits-only view that diffs against the committed head.
5. **Come back.** `q` quits (an in-flight Turn is aborted). Running the same command again reopens the same Workspace with the whole Conversation; Claude remembers earlier Turns because the session is resumed. `diff-explorer` with no argument shows Recents.

## 3. What already exists

| Path | State | Plan |
|---|---|---|
| `package.json` | Hono + Vite + React 19 + Agent SDK 0.3.319 + highlight.js + react-markdown. Scripts point at files that do not exist. | Drop Vite, Hono, react-dom, react-markdown, remark-gfm, highlight.js, tsx, concurrently. Add `@opentui/core`, `@opentui/react`, `web-tree-sitter` pinned exactly; `@types/bun`. Declare `engines.bun`. Pin the SDK exactly. Tests run with `bun test`. |
| `shared/types.ts` | Domain types: `Diff`/`DiffFile`/`Hunk`/`DiffLine`, `WorkspaceInfo`, `PRMeta`, `CodeRef`, `ChatRequest`, `ChatEvent`, `ChatBlock`, `ChatMessage`, `MODELS`. | Move to `core/types.ts`. Already JSON-only, so it satisfies the core rule in 4.1. |
| `shared/chatReducer.ts` | `applyChatEvent(msg, ev)`, pure. | Move to `core/chat/chatReducer.ts`. |
| `server/diffParser.ts` | `parseUnifiedDiff`, `buildDiff`. | Move to `core/diff/diffParser.ts`. Needs fixture tests. Gains a sibling `patchRenderer.ts` (4.4). |
| `server/exec.ts` | `exec` with typed `ExecError` over `child_process.execFile`. | Move to `core/exec.ts`. Bun implements the API; piped stdio is already the default. |
| `server/tsconfig.json` | `lib: ES2022`, no DOM. | Becomes `core/tsconfig.json`; that lib setting is now the point. |
| git | Branch `development`, zero commits. | Commit the scaffold first. |

## 4. Architecture

```
 tui/  (OpenTUI React, runs on Bun)               later: web/ (React) + http/ (Hono, SSE)
 ┌────────────────────────────────┐              ┌──────────────┐   ┌─────────────────┐
 │ panes, keymap, mouse handlers, │              │ browser app  │──▶│ routes over core│
 │ diff row mapping, syntax style │              └──────────────┘   └────────┬────────┘
 └───────────────┬────────────────┘                                         │
                 │ in-process calls                                         │
 ┌───────────────▼───────────────────────────────────────────────────────────▼────────┐
 │ core/  (runtime-agnostic: no DOM, no OpenTUI, no React, no stdout, no bun: imports)│
 │   workspace/  Workspace ── Git (exec) ── PRSource (gh adapter | fake)              │
 │   reviewer/   Reviewer ── AgentRuntime (Agent SDK adapter | scripted fake)         │
 │   diff/       diffParser   patchRenderer   selection   refRenderer                 │
 │   chat/       chatReducer  transcriptStore                                          │
 │   types.ts                                                                          │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

Two deep modules carry the product: **Workspace** and **Reviewer**. The TUI is deliberately shallow: it renders state and maps keys and mouse events to calls. The one new design element is the rule that keeps the web frontend cheap later.

### 4.1 The core rule

Every interface in `core/` takes and returns JSON-serialisable values. Streams are `AsyncIterable` of JSON-serialisable events. No callbacks, class instances, Node streams or file handles cross the line. Nothing in `core/` imports OpenTUI, React, `process.stdout`, `bun:*` modules or the DOM.

Why: an interface that is already "a request in, JSON or a JSON event stream out" maps onto HTTP plus SSE without redesign. That is the only thing the future web layer needs, so the seam is kept honest by shape, not by building a transport nobody uses yet. Keeping `bun:` imports out means the same core can run under Node behind that web layer.

Enforced by `core/tsconfig.json` (`lib: ["ES2022"]`, `types: ["node"]`), an ESLint `no-restricted-imports` rule forbidding `tui/`, `@opentui/*`, `react` and `bun:*` inside `core/`, and one test that greps `core/` for those imports so the rule fails loudly rather than silently.

### 4.2 Workspace (`core/workspace/`)

Interface:

```ts
open(target: string, opts?: { baseRef?: string; onProgress?: never }): Promise<WorkspaceInfo>
progress(target: string): AsyncIterable<{ step: "clone" | "fetch" | "checkout" | "diff"; detail?: string }>
get(key: string): WorkspaceInfo | undefined
diff(key: string): Promise<Diff>                       // always fresh, dirty flags set
fileContent(key: string, path: string, side: Side): Promise<string | null>
revert(key: string, path: string): Promise<void>       // Dirty Files only
listRecent(): RecentEntry[]
```

`open` returns when the checkout is ready; `progress` is the JSON event stream a UI subscribes to for the status line (the core rule forbids an `onProgress` callback, hence the second method).

What a caller must know beyond the signatures:

- `target` is a PR URL, `owner/repo#n`, or an absolute local path. `key` is `pr:owner/repo#n` or `local:/abs/path` and is stable across reopens.
- `open` is idempotent. Reopening a PR fetches its latest Head. Reopening a local target recomputes Base.
- `diff` compares the working tree to Base, so Edits and uncommitted work are always included. It is never cached across Turns.
- Errors: `TargetNotFound`, `NotAGitRepo`, `GhNotAuthenticated`, `PrCheckoutConflict` (another PR of the same repo is open with Dirty Files).

What it hides: `gh pr view --json ...`, the clone location and `--filter=blob:none`, `gh pr checkout --force`, merge-base resolution, the exact `git diff` flags, untracked-file synthesis, `git status --porcelain` for dirty detection, recents persistence.

Dependencies and seams (categories from the codebase-design DEEPENING guide):

- **Git**: local-substitutable. Tests build a throwaway repository in a temp dir with a fixture script (base commit, feature branch, committed change, uncommitted edit, untracked file, a rename, a binary). No port; the real `git` runs in the suite.
- **PRSource**: true external. Port `PRSource { view(ref): Promise<PRMeta & { cloneUrl }>; checkout(dir, n): Promise<void> }` with a `gh` adapter and an in-memory fake.

Disk layout, all under `~/.diff-explorer/`:

```
workspaces/<owner>__<repo>/     one partial clone per repository, reused across PRs
transcripts/<key-slug>.json     Conversation per Workspace
recent.json
```

Diff computation:

1. `baseSha = git merge-base <baseRef> HEAD`; for PRs `baseRef` is `origin/<baseRefName>` after a fetch; for local targets it defaults to `origin/HEAD`, falling back to `main` then `master`, overridable with `--base`.
2. `git diff --no-color --no-ext-diff -M -U3 <baseSha>` parsed by `parseUnifiedDiff`.
3. Untracked files from `git status --porcelain -z` are synthesised as `added` File Changes from their content, so the user's index is never touched.
4. Paths in `git status` mark `dirty: true`.

### 4.3 Reviewer (`core/reviewer/`)

Interface:

```ts
ask(wsKey: string, req: ChatRequest, opts: { autoAcceptEdits: boolean }): AsyncIterable<ChatEvent>
resolvePermission(wsKey: string, requestId: string, allowed: boolean): void
abort(wsKey: string): void
transcript(wsKey: string): ChatMessage[]
```

Invariants callers rely on:

- One active Turn per Workspace. A second `ask` while busy rejects with `WorkspaceBusy`.
- Events arrive in the order `applyChatEvent` expects, and `done` is always the final event, also on failure or abort.
- `done.filesChanged` comes from `git status` before versus after the Turn, never from tool output.
- An unresolved Permission Request is denied after 10 minutes or when the Turn is aborted.
- The transcript is persisted as events arrive, so a quit mid-Turn loses nothing already streamed.

What it hides: the Agent SDK `query()` configuration, the review system prompt, Code Ref rendering into the Prompt, session id bookkeeping for `resume`, `SDKMessage` to `ChatEvent` translation, the pending-permission map, the busy lock, cost accounting, transcript persistence.

Dependencies and seams:

- **AgentRuntime**: true external. Port `AgentRuntime { run(input: RunInput): AsyncIterable<SDKMessage> & { abort(): void } }`. Adapters: `AgentSdkRuntime` (real) and `ScriptedRuntime` (replays recorded `SDKMessage` fixtures, including one that triggers `canUseTool`). The port exposes the SDK's own message type on purpose: translating is the Reviewer's job, and the fake stays honest.
- **Internal seam** `translateSdkMessage(msg, state): ChatEvent[]`: pure, tested directly, not part of the interface.
- **TranscriptStore**: local-substitutable (temp dir in tests). Uses `applyChatEvent` so what is saved is exactly what the UI rendered.

Agent SDK call per Turn (option semantics in the research note):

```ts
query({
  prompt: renderPrompt(req.message, req.refs),
  options: {
    cwd: ws.dir,
    model: req.model ?? ws.model,
    resume: ws.sessionId,                      // undefined on the first Turn
    includePartialMessages: true,
    permissionMode: opts.autoAcceptEdits ? "acceptEdits" : "default",
    allowedTools: ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git blame:*)"],
    disallowedTools: ["WebSearch", "WebFetch", "Agent"],
    canUseTool: permissionBridge(wsKey),
    systemPrompt: { type: "preset", preset: "claude_code", append: reviewPrompt(ws) },
    settingSources: ["project"],               // the reviewed repo's CLAUDE.md, not the reviewer's global config
    hooks: { PostToolUse: [{ matcher: "Edit|Write|MultiEdit", hooks: [noteEdit] }] },
    enableFileCheckpointing: true,             // enables per-Turn undo later
    abortController,
    maxBudgetUsd: 5,
    stderr: log,                               // never the terminal: the TUI owns stdout
  },
})
```

One `query()` per Turn with a string prompt, resumed by session id, rather than one long-lived streaming-input query: one Turn is one process, abort is an `AbortController`, and model or permission changes per Turn are free. The cost is a process spawn per Turn. If that latency hurts, switching to streaming-input mode is contained inside `AgentSdkRuntime`.

Under Bun the SDK auto-detects the runtime (`executable` option) and spawns Claude Code with `bun`, over pipes, so it never touches the renderer's raw-mode stdin. Nothing to configure; verified in Phase 4.

Permission bridge: `canUseTool` creates a request id, emits `permission_request`, and parks a resolver. `resolvePermission` settles it with `{ behavior: "allow" }` or `{ behavior: "deny", message: "Denied by reviewer" }`. The SDK's abort `signal` and the 10-minute timer both resolve to deny.

Review system prompt (appended to the Claude Code preset): who the user is, what the checkout is (PR title, `base...head`, how to see the whole diff with `git diff <baseSha>`), how `code_ref` blocks are formatted and that they quote the Diff verbatim, prefer answering from refs and `Read` for more context, never `git commit` or `git push`, make minimal Edits with the `Edit` tool when asked, answer in concise markdown.

### 4.4 Pure diff logic (`core/diff/`)

- `diffParser.ts` (exists): unified diff text to `DiffFile[]`.
- `patchRenderer.ts`: `renderPatch(file: DiffFile): string`, the inverse of the parser: one file's `diff --git` header, `---`/`+++` lines, hunk headers and lines. The TUI feeds this text to `<diff>`, which renders from unified-diff text; it also gives synthesised untracked files and the edits-only view a patch when git never produced one. Round-trip tested: `parseUnifiedDiff(renderPatch(f))` equals `f`.
- `selection.ts`: `selectionReducer(state, action)` with actions `anchor(line)`, `extend(line)`, `clear`, where `line` is `{ file, side, lineNo }`, plus `captureRef(diff, selection): CodeRef`. Keyboard and mouse both end in these actions, so the model is device-neutral, lives in core, and the future web UI reuses it.
- `refRenderer.ts`: `renderPrompt(message, refs): string`:

```
<code_ref id="r1" file="src/api/users.ts" side="new" lines="42-57">
42  | export async function getUser(id: string) {
43 +|   const cached = cache.get(id);
</code_ref>
```

A `new`-side ref contains add and context lines numbered on the new Side; an `old`-side ref contains del and context lines numbered on the old Side. The `+`/`-` marker is kept so Claude can tell changed lines from context. The chip label is `users.ts:42-57`.

### 4.5 TUI (`tui/`)

Stack: OpenTUI 0.8.3 (`@opentui/react` over `@opentui/core`) on Bun 1.3.14+, with the React 19.3 already present; tree-sitter for syntax colours; `util.parseArgs` for the CLI. Every API named below was checked against the shipped type definitions; details and open questions in the stack note.

| Module | Interface it offers the rest of the TUI | Hides |
|---|---|---|
| `cli.ts` | parses args, calls `Workspace.open`, creates the renderer, mounts `<App>` | `createCliRenderer` options (alternate screen, mouse on, `exitOnCtrlC`), `renderer.destroy()` on quit, exit codes, non-TTY error, a log file for core because the renderer captures `console.*` |
| `App.tsx` | owns `AppState` via `useReducer`, wires core calls to actions, one global `useKeyboard` handler, `Tab` and click-to-focus | subscribing to `Reviewer.ask` and `Workspace.progress` streams |
| `appReducer.ts` | pure reducer: focus, cursor, collapsed files, pane visibility, pending confirmation, basket, messages (via `applyChatEvent`) | all keyboard and mouse semantics; tested directly |
| `diffRows.ts` | pure `rowsForFile(file): Row[]` (hunk header or line, in `<diff>` order), `rowAt(file, row): Row`, `rowOfLine(file, side, lineNo): number` | the mapping between terminal rows of a `<diff>` and `DiffLine`s; the file's height; tested directly and cross-checked against `getHunkRowOffsets()` |
| `keymap.ts` | table `{ pane, key } -> action` | help overlay is generated from this table, so help can never drift |
| `DiffPane` | `files`, `cursor`, `selection`, `collapsed` | one `<scrollbox>`; per file a header `<box>` plus a `<diff>` with `wrapMode: "none"`, `height` from `diffRows`, `filetype` from the path; Selection painted with `highlightLines`, cursor with `setLineColor`; `onMouseDown`/`onMouseDrag` on the gutter columns dispatch `anchor`/`extend`; `scrollChildIntoView` for `]`/`[`, `o` and file clicks; dirty marker in the header |
| `FilesPane` | `files`, `active`, `viewed` | `<scrollbox>` of rows, click to jump, status badges, counts, dirty dot |
| `ChatPane` | `messages`, `basket`, `busy`, `pendingPermission` | `<scrollbox stickyScroll stickyStart="bottom">`; streaming answers in `<markdown streaming>` finalised on `text_final`; collapsed tool lines; permission card with clickable `[allow]`/`[deny]`; cost line; `<textarea>` composer with Enter bound to submit |
| `syntax.ts` | `syntaxStyle(renderer)`, `filetypeFor(path)` | the colour palette as a `SyntaxStyle`, `pathToFiletype`, grammar registration via `addDefaultParsers(await getParsers())` |
| `grammars/` | generated by `@opentui/core/tree-sitter/update-assets` from a pinned config | `.wasm` and `highlights.scm` for the languages beyond the bundled JS, TS, TSX, Markdown and Zig: Python, Go, Rust, JSON, YAML, CSS, HTML, Bash, Java, Kotlin, Swift, Ruby. Unknown languages render uncoloured |

Layout by terminal width: 160 columns or more shows files 26, diff flexible, chat 60; 110 to 159 shows diff and chat with the files pane as an overlay on `f`; under 110 shows one pane at a time and `Tab` switches. Height comes from `useTerminalDimensions`; each pane is a `<scrollbox>` with `flexGrow: 1, flexBasis: 0, minHeight: 0`, so nothing ever grows into scrollback.

Rendering budget: OpenTUI repaints changed cells natively and skips painting scrollbox children outside the viewport, so a keypress costs a layout pass plus the visible cells. `text_delta` events are appended to the streaming `<markdown>` content at most 30 times a second. Highlighting is tree-sitter per file, so multi-line constructs colour correctly from the start. The Phase 2 spike measures a 5000-row Diff before the pane is built on these assumptions.

Mouse (also in the help overlay):

| Gesture | Where | Action |
|---|---|---|
| wheel | any pane | scroll (built in) |
| click | any pane | focus it |
| click | files row | jump the diff to that file |
| click | file header | collapse or expand |
| click | `⋯` row under a hunk header | expand context |
| click | line number | move cursor, start Selection |
| drag down the gutter, or shift-click | diff | extend Selection |
| drag across code text | diff, chat | built-in text selection for copying; never touches the Selection |
| click | `[allow]` / `[deny]`, ref chip, collapsed tool line | allow or deny, jump, expand |
| click | composer | focus it |

Keys (also in the help overlay):

| Key | Where | Action |
|---|---|---|
| `Tab` / `Shift-Tab` | any | cycle focus files, diff, chat |
| `j` `k` `Ctrl-d` `Ctrl-u` `g` `G` | diff, files, chat | move, page, top, bottom |
| `]` `[` | diff | next / previous file |
| `Enter` | diff | expand or collapse file under cursor; expand tool entry in chat |
| `x` | diff, on a hunk header | expand context |
| `v` | diff | start or extend Selection; `Esc` clears |
| `a` / `A` | diff | add Selection (or hunk) / whole file to Basket |
| `o` | chat | jump diff to the ref under cursor |
| `i` | any | focus composer; `Enter` sends, `Shift-Enter` newline, `Esc` leaves |
| `y` / `n` | chat, permission card | allow / deny |
| `e` | any | toggle auto-accept edits |
| `m` | any | cycle model for the next Turn |
| `r` / `d` | any | refresh Diff / toggle edits-only view |
| `R` | diff or files, on a Dirty File | revert after confirmation |
| `X` | any | abort the running Turn |
| `?` / `q` | any | help / quit |

### 4.6 CLI surface

```
diff-explorer <target> [--base <ref>] [--model <id>]
diff-explorer                       # Recents
diff-explorer ask <target> "question" [--ref path:10-20]...   # Phase 6: non-interactive, prints the answer
```

The `bin` entry runs under Bun (`#!/usr/bin/env bun`). The `ask` subcommand is the first proof that core is UI-independent: it is a second caller of `Workspace` and `Reviewer` that never creates a renderer, and it doubles as the end-to-end test entry point.

## 5. Testing strategy

Framework: `bun test`. Following the tdd skill: write the test at the module's interface first, make it pass, then tighten. Panes get smoke tests through OpenTUI's test renderer; the logic they display is tested in the reducers.

| Module | Test surface | Fixtures |
|---|---|---|
| `diffParser` | `parseUnifiedDiff` | `.diff` files: rename, copy, binary, no-newline, quoted unicode path, multiple hunks, empty file |
| `patchRenderer` | `renderPatch` round-trips through `parseUnifiedDiff` | the same fixtures |
| `selection` | reducer + `captureRef` | synthetic `Diff` |
| `refRenderer` | `renderPrompt` | hand-built `CodeRef`s, both Sides |
| `chatReducer` | `applyChatEvent` | event sequences including out-of-order and error cases |
| `translateSdkMessage` | pure function | recorded `SDKMessage` JSON from one real run against a tiny repo, committed once |
| `Workspace` | `open`/`diff`/`fileContent`/`revert` on a temp git repo | fixture script builds the repo; `PRSource` fake returns canned `PRMeta`; one opt-in test hits real `gh` when `DIFF_EXPLORER_E2E=1` |
| `Reviewer` | `ask`/`resolvePermission`/`abort` with `ScriptedRuntime` | scripts: plain answer, tool use needing permission (allow and deny), error result, abort mid-stream; assert `done` is always last |
| `appReducer`, `diffRows`, `keymap` | pure functions | synthetic state; every keymap entry maps to an action the reducer handles; `rowAt(rowOfLine(l)) === l` |
| `core` boundary | grep test | fails if `core/` imports `@opentui`, `react`, `bun:` or `tui/` |
| panes | `testRender(<App/>, { width: 120, height: 40 })` from `@opentui/react/test-utils` with `MockTreeSitterClient`: frame contains the file names; `mockMouse.click` on a gutter row selects that line; `mockInput.pressKey("j")` moves the cursor; `mockMouse.scroll` moves the diff | small Diff |

Replace, don't layer: once `Workspace` has interface tests, no separate tests for its internal git helpers.

## 6. Phases and commits

Each bullet that ends with a commit message is one local commit, made as soon as that feature is verified. Nothing is pushed.

### Phase 0: foundation (half a day)

- Commit the existing scaffold as-is. `chore: scaffold server, web and shared types`
- Install Bun (`brew install oven-sh/bun/bun`). Restructure into `core/` and `tui/`, move the existing files, drop the web dependencies, add OpenTUI pinned, `bun test`, the boundary test, `engines.bun`, pin the SDK. `chore: terminal-first layout with core and tui on bun`
- Docs: glossary, ADRs 0001 to 0005, research notes, this plan. `docs: glossary, ADRs and implementation plan`
- `diff-explorer --version`, and a hello `<App>` that opens in the alternate screen, shows terminal size and mouse position, and exits cleanly on `q` and on `Ctrl-c` with the terminal restored. `feat: cli entry and full-screen shell`

### Phase 1: Workspace (1 day)

- `diffParser` fixture tests, fix anything they find; `patchRenderer` with the round-trip test. `test: diff parser fixtures and patch renderer`
- Workspace for local targets: open, progress stream, merge-base, diff with dirty flags and untracked synthesis, fileContent, revert. Temp-repo integration tests; confirm `exec` under Bun leaves stdin alone. `feat: workspace for local repositories`
- `PRSource` port, `gh` adapter, fake; PR open with partial clone and checkout; the error cases. `feat: open pull requests via gh`

### Phase 2: diff viewer (1.5 days)

- Spike, throwaway, half a day: stacked `<diff>`s inside a `<scrollbox>` on a real 3000-line PR. Answers the five open questions in the stack note (self-sizing, line index semantics, gutter drag versus text selection, repaint cost, newline binding). Findings go into the stack note. `docs: opentui spike findings`
- `diffRows` and `appReducer` for cursor, paging, collapse. Tests first. `feat: diff row model and navigation reducer`
- `DiffPane`: stacked diffs, cursor line, syntax palette, grammar assets for the first languages. Benchmark on a 5000-row Diff: a keypress must repaint under 50 ms. `feat: diff pane`
- `FilesPane`, header line, status line, layout modes by width, click to jump, click to focus. `feat: files pane and responsive layout`
- Expand context on hunk headers via `fileContent` (keyboard and click); Recents screen for a bare `diff-explorer`. `feat: expand hunk context and recents`

### Phase 3: Code Refs (1 day)

- `selection.ts` reducer and `captureRef` in core, tests first. `feat: line selection model`
- Keyboard visual mode, gutter click, drag and shift-click, Selection painted with `highlightLines`, `a`/`A`, Basket chips, stale marking against the current Diff. `feat: select lines by keyboard and mouse`
- `refRenderer` with tests. `feat: render code refs into prompts`

### Phase 4: Reviewer, explain mode (1.5 days)

- `AgentRuntime` port, `ScriptedRuntime`, recorded fixtures. `feat: agent runtime port and scripted fake`
- `translateSdkMessage` with tests. `feat: translate sdk messages to chat events`
- `Reviewer.ask` with busy lock, session resume, abort, transcript persistence; `AgentSdkRuntime` under Bun; verify the open questions in the SDK note, including that the child process does not share the renderer's raw-mode stdin. `feat: reviewer turns over the agent sdk`
- `ChatPane` and composer: streaming markdown, collapsed tool lines, cost line, abort, model cycling, sticky scroll. `feat: chat pane`

### Phase 5: Edits (1 day)

- Permission bridge, permission card with `y`/`n` and clickable buttons, auto-accept toggle. `feat: permission requests in the chat pane`
- `filesChanged` from git status, automatic Diff refresh after `done`, dirty markers, revert with confirmation. `feat: reflect claude edits in the diff`
- Edits-only view against the committed Head. `feat: edits-only view`

### Phase 6: polish (1 to 2 days)

- Help overlay generated from the keymap and mouse table, friendlier error screens (Bun too old, gh not logged in, not a repo, narrow terminal). `feat: help overlay and error screens`
- `ask` subcommand. `feat: non-interactive ask command`
- Grammar coverage pass: add the languages the first real PRs hit. `feat: more syntax grammars`
- Cost totals per Conversation, large-PR performance pass, optional `bun build --compile` single binary. One commit each.

### Later, not scheduled

**Web frontend** as in appendix A. Split view: `view="split"` on `<diff>` when the terminal is 200 columns or wider, one prop away. Post review comments via `gh api` behind an explicit confirm. Commit and push behind confirms. Per-Turn undo with `rewindFiles()` (needs streaming-input mode). Several Workspaces at once (worktrees). Existing PR review comments shown inline. A Node runtime path if the OpenTUI React binding gains a Node CI lane.

## 7. Decisions (confirmed 2026-11-11)

1. **OpenTUI on Bun for the terminal UI** (ADR-0005). Its diff, scrollbox, mouse, tree-sitter and markdown renderables are exactly the parts Phase 2 would otherwise build; the price is Bun as the runtime and 0.x churn, pinned.
2. **Mouse in v1** as in the gesture table: wheel, click to focus and navigate, gutter click and drag for Selection, text drag for copying. Every mouse action has a key, so a multiplexer without mouse mode loses nothing.
3. **Unified view only in v1.** Split is one prop away and is scheduled under Later for wide terminals.
4. **One package with `core/` and `tui/` folders**, boundary enforced by tsconfig, lint and a test. Promote to npm workspaces when `web/` arrives, not before.
5. Earlier decisions stand: one clone per repository, local targets edit the real checkout, reads auto-allowed and edits ask, web tools and subagents off in v1, default model Opus 5.5.

## 8. Risks

- **Bun is a prerequisite for users.** One install step; declared in `engines` and the README. A `bun build --compile` binary removes it later.
- **OpenTUI 0.x and the undocumented per-line diff API.** Pinned exactly; the Phase 2 spike proves the API before the pane depends on it. Fallback if `<diff>` cannot do line selection: `DiffPane` renders its own `<text>` rows from `diffRows` inside the same `<scrollbox>`, losing tree-sitter colours but nothing else.
- **Terminal width.** Three panes need 160 columns; the responsive modes cover 80 to 159.
- **Raw-mode stdin versus child processes.** The renderer owns stdin; `git` and the SDK run over pipes. Verified in Phases 1 and 4.
- **Session resume with a model change** may not be supported. Verified in Phase 4; fallback is a fresh session with our transcript intact.
- **Grammar coverage.** Languages without a registered grammar render uncoloured; the first PRs decide which to add in Phase 6.
- **Mouse in multiplexers.** tmux needs `set -g mouse on`; without it the keyboard covers everything.
- **SDK churn.** Pinned exactly; only `AgentSdkRuntime` imports it; recorded fixtures catch translation breakage on upgrade.

## Appendix A: the future web layer

Nothing in core changes. Two new folders:

- `http/`: Hono routes that call core and serialise. `Reviewer.ask` becomes `text/event-stream` with one `ChatEvent` per `data:` line; `Workspace.progress` likewise. Everything else is request in, JSON out.
- `web/`: a Vite + React app that reuses `core/types`, `chatReducer`, `selection` and `refRenderer` through the bundler, and reimplements only what is terminal-specific in `tui/` (panes, keymap, row mapping).

| Method | Path | Core call |
|---|---|---|
| `POST` | `/api/workspaces` | `Workspace.open` |
| `GET` | `/api/workspaces/:key` | `Workspace.get` + `diff` + `Reviewer.transcript` |
| `GET` | `/api/workspaces/:key/diff` | `Workspace.diff` |
| `GET` | `/api/workspaces/:key/file?path&side` | `Workspace.fileContent` |
| `POST` | `/api/workspaces/:key/chat` (SSE) | `Reviewer.ask` |
| `POST` | `/api/workspaces/:key/permissions/:requestId` | `Reviewer.resolvePermission` |
| `POST` | `/api/workspaces/:key/abort` | `Reviewer.abort` |
| `POST` | `/api/workspaces/:key/revert` | `Workspace.revert` |
| `GET` | `/api/recent` | `Workspace.listRecent` |

The web walkthrough from the first version of this plan (three-column layout, click and shift-click selection, permission cards, reattach to an in-flight Turn) applies unchanged to that layer, and the click and shift-click selection now has a terminal twin feeding the same `selectionReducer`.
