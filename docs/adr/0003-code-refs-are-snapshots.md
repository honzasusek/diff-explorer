---
status: accepted
---

# Code Refs capture their lines, not just their coordinates

A Code Ref stores the referenced lines as they were when selected, alongside file, Side and line range. Claude edits files during Turns, so line numbers drift within a Conversation; a snapshot keeps the transcript reproducible, keeps the ref chip renderable after the lines moved or the file was reverted, and lets the Prompt quote exactly what the reviewer saw. The coordinates are kept for scroll-to and so Claude can Read around them.

## Consequences

- A ref can become a Stale Ref. The UI marks it stale when the captured lines no longer match the current Diff rather than silently re-pointing it.
- Refs are small, so duplicating text into the transcript is cheap. Whole-file refs are capped to the file's changed Hunks, not the full file.
