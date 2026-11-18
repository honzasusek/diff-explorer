# Claude Agent SDK: facts the Reviewer module relies on

> Belongs to the parked terminal app plan ([docs/plans/cli-app.md](../plans/cli-app.md)). The Claude Code mod (ADR-0006) does not use the Agent SDK; Claude Code itself is the reviewer.

Source: the installed package `@anthropic-ai/claude-agent-sdk@0.3.319`, file `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (line numbers below), plus its README. Verified 2026-11-09. Re-verify on every SDK bump; this is a 0.x line.

## Entry point

- `query({ prompt, options })` returns `Query`, an `AsyncGenerator<SDKMessage>` (sdk.d.ts:3376). `prompt` is a `string` or an `AsyncIterable<SDKUserMessage>`.
- Control methods on `Query` (`interrupt()`, `setPermissionMode()`, `setModel()`, `rewindFiles()`, `applyFlagSettings()`) are only available in streaming-input mode, i.e. when `prompt` is an async iterable (Query interface, "Control Requests" comment). With a string prompt, cancel through `options.abortController`.
- `/core` entry exists for bundlers; the root entry is fine for a Node server. Never import both in one process (README).

## Options we use (type `Options`, sdk.d.ts ~1600-2400)

| Option | Behaviour (from the doc comment) |
|---|---|
| `cwd` | Working directory for the agent and its tools. |
| `additionalDirectories` | Extra absolute paths Claude may access. We leave it unset so Claude stays inside the Workspace. |
| `model` | Model id for the session. |
| `resume` | "Session ID to resume. Loads the conversation history from the specified session." |
| `persistSession` | Default `true`; sessions are saved under `~/.claude/projects/` and can be resumed. |
| `includePartialMessages` | When `true`, `SDKPartialAssistantMessage` (`type: 'stream_event'`) events are emitted during streaming. |
| `permissionMode` | `'default'` prompts for dangerous operations, `'acceptEdits'` auto-accepts file edits, `'plan'` runs no tools, `'dontAsk'` denies anything not pre-approved, `'auto'` uses a classifier, `'bypassPermissions'` needs `allowDangerouslySkipPermissions`. |
| `allowedTools` | "Tool names that are auto-allowed without prompting." Does not restrict availability. |
| `tools` | Restricts which tools exist (array of names or the `claude_code` preset). |
| `disallowedTools` | Removes tools. |
| `canUseTool` | Custom permission handler, called before each tool execution. |
| `systemPrompt` | `string`, or `{ type: 'preset', preset: 'claude_code', append }` to keep the Claude Code prompt and add ours. |
| `settingSources` | Omitted loads user+project+local like the CLI. `[]` is isolation mode. Must include `'project'` to load the reviewed repo's CLAUDE.md. |
| `hooks` | `Partial<Record<HookEvent, HookCallbackMatcher[]>>`; `PostToolUse` input carries `tool_name`, `tool_input`, `tool_response`, `tool_use_id`. |
| `enableFileCheckpointing` | Backs up files before modification so `Query.rewindFiles()` can restore them to any user-message boundary. Streaming-input mode only for the rewind call. |
| `abortController` | Aborting stops the query and cleans up. |
| `maxBudgetUsd` / `maxTurns` | Stop the query with `error_max_budget_usd` / `error_max_turns` results. |
| `effort` | `'low' | 'medium' | 'high' | 'xhigh' | 'max'`. |
| `thinking` | `{ type: 'adaptive' }`, `{ type: 'enabled', budgetTokens, display }`, or `{ type: 'disabled' }`. |
| `stderr` | Callback for the CLI's stderr; wire to server logs. |

## Messages we translate (`SDKMessage`, sdk.d.ts:5666)

| SDK message | Shape | Becomes `ChatEvent` |
|---|---|---|
| `system` / `subtype: 'init'` | `session_id`, `model`, `tools`, `permissionMode`, `cwd` | `session` (persist `sessionId` on the Workspace) |
| `stream_event` | `event` is one raw Messages API streaming event (`message_start`, `content_block_start`, `content_block_delta`, ...); `parent_tool_use_id` is non-null inside subagents | `text_start` on `content_block_start` of a text block, `text_delta` on `text_delta`; subagent events skipped |
| `assistant` | `message: BetaMessage` with `content` blocks (`text`, `tool_use`, `thinking`) | `text_final` per text block, `tool_use` per tool_use block |
| `user` | `message.content` holds `tool_result` blocks; `tool_use_result` is the structured output | `tool_result` with a truncated summary |
| `result` / `subtype: 'success'` | `total_cost_usd`, `duration_ms`, `num_turns`, `session_id`, `permission_denials`, `result` text | `done` |
| `result` / `subtype: 'error_during_execution' \| 'error_max_turns' \| 'error_max_budget_usd' \| 'error_max_structured_output_retries'` | plus `errors: string[]` | `done` with `error` |

Other members of the union (`status`, `tool_progress`, `api_retry`, `compact_boundary`, `rate_limit_event`, ...) are logged and otherwise ignored in v1.

## Permission bridge

`CanUseTool = (toolName, input, { signal, suggestions?, blockedPath?, mcpServer? }) => Promise<PermissionResult>` (sdk.d.ts:228). `PermissionResult` is `{ behavior: 'allow', updatedInput?, updatedPermissions? }` or `{ behavior: 'deny', message, interrupt? }`. The `signal` aborts when the query is aborted; a pending browser prompt must resolve to deny on abort.

## Model ids

From the `claude-api` skill table, current at 2026-10-06: `claude-opus-5-5` (default, $4/$20 per MTok), `claude-sonnet-5-5` ($2/$10), `claude-fable-5-1` ($10/$50). These already match `MODELS` in `shared/types.ts`. Thinking is always on for these models; depth is controlled with `effort`.

## Auth

The SDK uses Claude Code's credentials (`ANTHROPIC_API_KEY`, or the login stored by `claude`). `claude` 2.1.319 is installed on this machine; the SDK bundles its own CLI binary regardless.

## To verify during Phase 4 (not settled by the types)

1. Whether `resume` accepts a different `model` than the session started with. Fallback: start a fresh session and keep our own transcript.
2. The exact `tool_use_result` shape for `Edit`/`Write`, for a fast "files changed" path. Source of truth stays `git status` before and after the Turn, so this only affects latency of the dirty markers.
3. Whether `settingSources: ['project']` also loads the reviewed repo's `.claude/settings.json` permissions, and whether that is desirable.

4. That the Agent SDK child process does not inherit the renderer's raw-mode stdin (OpenTUI holds stdin in raw mode for the whole session). If it does, pass an explicit `spawnClaudeCodeProcess` with `stdio: ["pipe", "pipe", "pipe"]`.

## Runtime

`Options.executable?: 'bun' | 'deno' | 'node'` (sdk.d.ts line 1749) is "auto-detected if not specified": the bundle returns `bun` when `process.versions.bun` is set, `node` otherwise, and runs Claude Code with that executable. Under Bun (ADR-0005) nothing is configured. The SDK uses Node's `child_process` API, which Bun implements.
