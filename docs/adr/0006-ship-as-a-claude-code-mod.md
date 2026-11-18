---
status: accepted
---

# Ship as a Claude Code mod, not a standalone terminal app

The product is a diff pane, a way to pick lines into Code Refs, and Claude answering about them with real tools in a real checkout. Claude Code already provides the second half: transcript, prompt, tools, permissions, cost, session resume, and panes a plugin can draw. We build the first half as a Claude Code mod (a plugin hooks module) instead of a standalone app that embeds Claude through the Agent SDK, because that removes the Reviewer module, the chat pane, the permission bridge and a second runtime, and leaves a pure `core/` plus a thin hooks layer. The standalone plan is parked, not deleted.

## Considered options

- **Standalone terminal app on OpenTUI and Bun** (ADR-0005, plan at `docs/plans/cli-app.md`). Full control of layout, drag and shift-click line selection, a split view later, and a core that already runs outside Claude Code. Costs a second runtime, an embedded Claude Code process per Turn, our own chat pane and permission UI, and about seven days against four to five.
- **Web app** as first planned. The most familiar diff UI, but a server, a transport and a bundler before the first useful review.
- **Claude Code mod.** Chosen. Line selection is limited to what the engine offers (terminal text selection, button presses without modifiers, typeahead in the prompt), the drawing is limited to engine elements, and the API is declared per build rather than versioned as a package.

## Consequences

- No Agent SDK, no OpenTUI, no Bun, no runtime packages. ADR-0001 and ADR-0005 are superseded; `docs/research/claude-agent-sdk.md` and `docs/research/tui-stack.md` stay as the parked plan's notes.
- The session's working directory is the Workspace: PRs are checked out in place with `gh pr checkout`, and Edits land in the reviewer's own checkout. ADR-0002 is amended accordingly; its reasons (Claude needs a filesystem) still hold.
- `core/` must not import packages or Node built-ins, because the engine loads only the plugin's own files. Process execution goes through a Runner port with two adapters, `$.process.run` in the mod and `child_process` in tests and in the parked app.
- Permissions, model choice and cost are Claude Code's own; the mod does not touch them.
- If the mod proves lacking (selection too clumsy, pane too constrained), the parked plan resumes with `core/` as it stands; only the hooks layer is mod-specific.
