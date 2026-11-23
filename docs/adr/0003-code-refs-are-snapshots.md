---
status: accepted
---

# Code Refs capture their lines, not just their coordinates

A Code Ref stores the referenced lines as they were when selected, alongside file, Side and line range. Claude edits files during Turns, so line numbers drift within a Conversation; a snapshot keeps the transcript reproducible, keeps the ref chip renderable after the lines moved or the file was reverted, and lets the Prompt quote exactly what the reviewer saw. The coordinates are kept for scroll-to and so Claude can Read around them.

## Consequences

- A ref can become a Stale Ref. The UI marks it stale when the captured lines no longer match the current Diff rather than silently re-pointing it.
- Refs are small, so duplicating text into the transcript is cheap. A whole-file ref (`+file`) is the exception: it captures every line of the file, changed or not, since the person pressed it to hand Claude the file (changed 2026-11-23; it used to hold only the changed Hunks, which read as a second `+hunk`). A file too large for the Runner falls back to its changed Hunks.
- A whole-file ref cannot be found as a run in the Diff, which shows three lines around each change. It is fresh while the Diff's changed lines are its changed lines, in order, and every line the Diff shows stands in it as captured.
