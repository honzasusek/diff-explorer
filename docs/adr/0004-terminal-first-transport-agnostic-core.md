---
status: accepted, amended by ADR-0006 (the first UI is a Claude Code mod rather than a standalone terminal app; the core rule stands)
---

# Terminal UI first, over a core that does not know its UI

The first shipped UI is a full-screen terminal app, not the web app originally planned. The product logic lives in `core/` under one rule: every interface takes and returns JSON-serialisable values, streams are async iterables of JSON events, and nothing in core imports a UI, `process.stdout` or the DOM. The TUI calls core in-process. A web frontend later adds a thin HTTP plus SSE layer over the same interfaces, which is cheap precisely because the interfaces are already request-in, JSON-out.

## Considered options

- **Web first, as planned.** Gives mouse selection and a familiar look, but needs a server, a transport, a bundler and two processes before the first useful review. More to build before learning whether the ask-and-edit loop is worth having.
- **Build the HTTP layer now and have the TUI call it.** Two adapters would make the seam "real" in codebase-design terms, but one of them would be pure overhead for a single-user local tool. The seam is kept honest by the JSON-only rule instead, enforced by a test.

## Consequences

- Line selection, mouse handling and the width-dependent layout are terminal facts, not core facts, so they live in `tui/`. The Selection model itself takes line coordinates and lives in core, so keyboard, mouse and the future web UI share it.
- `core/tsconfig.json` has no DOM lib, lint forbids UI imports in core, and a test fails the build if one slips in.
- The terminal framework and runtime are a separate decision, ADR-0005.
- The `ask` subcommand becomes the first non-TUI caller of core, which is the proof that the web layer will be a thin addition.
