---
status: accepted, amended by ADR-0006 (the Workspace is the session's own checkout; PRs are checked out in place)
---

# A Workspace is a real git checkout on disk

The Diff could be fetched from GitHub's API and rendered without cloning. We clone instead, because Claude's tools need a filesystem: explaining code needs context outside the hunk, and editing needs a working tree. A PR Review Target becomes a partial clone under `~/.diff-explorer/workspaces/` with the PR branch checked out; a local Review Target uses the user's repository path directly, so Edits land in their own checkout.

## Consequences

- Opening a PR costs a clone the first time (mitigated with `--filter=blob:none`; the clone is reused across PRs of the same repository).
- The Diff is computed by git against the merge-base and always compares the working tree, so Edits show up in the Diff without any special handling.
- One clone per repository means one open PR per repository at a time. Worktrees can lift that later without changing the interface.
- For local targets the tool is editing the user's real files. Reverting a Dirty File is a first-class action for that reason.
