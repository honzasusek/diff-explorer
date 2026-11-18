---
status: superseded by ADR-0006
---

# OpenTUI on Bun for the terminal UI

The terminal UI is built with OpenTUI (`@opentui/react` over `@opentui/core`) and the app runs on Bun. OpenTUI ships the parts a diff reviewer needs, a diff renderable with per-line colouring, a scrollbox, mouse input, tree-sitter highlighting and a markdown renderable, so the TUI stays a thin layer over core instead of growing its own viewport and renderer. Bun is the runtime OpenTUI supports; the Node path needs 26.4 with an experimental flag and the React binding is not tested there.

## Considered options

- **Ink 8 on Node 24.** Mature and runs on what is installed, but has no scrolling, no mouse and no diff or code rendering, so the diff viewer would be built from scratch in JavaScript, and mouse support in v1 would need a third-party library for input Ink 8 explicitly dropped.
- **OpenTUI on Node 26.4 with `--experimental-ffi`.** Avoids a second runtime but depends on an experimental flag and a binding without a Node CI lane.
- **OpenTUI on Bun.** Chosen. The Agent SDK auto-detects Bun and runs Claude Code under it, and Bun runs TypeScript and tests directly, which removes `tsx` and `vitest`.

## Consequences

- Bun >= 1.3.14 is required to run, test and develop the app; `package.json` declares it and the README says so. Node is not used.
- Both OpenTUI packages are pinned exactly: 0.x releases change APIs, and the per-line diff API this plan relies on is in the type definitions but not yet in the docs.
- Syntax colours depend on tree-sitter grammars: five are bundled, the rest are fetched as pinned assets at build time. A language without a grammar renders uncoloured, never wrong.
- `core/` stays runtime-agnostic (Node APIs that Bun implements, no `bun:` imports) so it can back a Node server later.
- Mouse is a v1 feature: wheel scrolling, click to focus and navigate, gutter click and drag for line selection, and the built-in text selection for copying.
