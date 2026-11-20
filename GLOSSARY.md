# Diff Explorer

A tool for reading a pull request or branch diff GitHub-style, with Claude attached to the same checkout so it can explain or edit the code by reference. Shipped first as a Claude Code mod; a standalone terminal app and a web layer share the same language.

## Language

### Targets and checkouts

**Review Target**:
The thing being reviewed: a GitHub pull request, or a branch in a local repository.
_Avoid_: project, repo, source

**Workspace**:
An opened Review Target: a checkout on disk together with its Diff and its Conversation. One Workspace per Review Target.
_Avoid_: session, project, tab

**Base**:
The commit the Diff is measured from: the merge-base between the target branch and the Head.
_Avoid_: main, origin, parent

**Head**:
The reviewed branch as it currently exists in the Workspace, including uncommitted Edits.
_Avoid_: tip, current, branch

### The diff

**Diff**:
The set of File Changes between Base and the Workspace's working tree. Recomputed after every Turn that produced Edits.
_Avoid_: patch, changes, changeset

**File Change**:
One file's part of the Diff: its status (added, deleted, modified, renamed, copied), its counts, and its Hunks.
_Avoid_: file diff, entry

**Hunk**:
A contiguous region of a File Change as git emits it, numbered on both Sides.

**Side**:
Which version of a file a line number refers to: Old (Base) or New (Head).
_Avoid_: left/right, before/after

**Dirty File**:
A File Change whose working-tree content differs from the committed Head, usually because of an Edit.
_Avoid_: modified (clashes with the status), touched

### Referencing code

**Selection**:
The in-progress gesture of picking lines in the Diff. Becomes a Code Ref when added to the Basket.

**Code Ref**:
A range of lines from one File Change and one Side, captured with its text, that is attached to a Prompt so Claude can be asked about it by reference.
_Avoid_: selection, snippet, highlight, citation

**Basket**:
The Code Refs waiting to be sent with the next Prompt.
_Avoid_: context, attachments, pins

**Stale Ref**:
A Code Ref whose captured lines no longer match the current Diff, typically after an Edit or a revert.

### Talking to Claude

**Conversation**:
The ordered Turns between the reviewer and Claude in one Workspace. Claude remembers earlier Turns; the Conversation survives reloads.
_Avoid_: chat, thread, session

**Turn**:
One Prompt and Claude's complete response to it, including any tool use.
_Avoid_: message, exchange, query

**Prompt**:
What the reviewer sends to start a Turn: free text plus zero or more Code Refs.
_Avoid_: question, message, instruction

**Permission Request**:
Claude asking the reviewer to approve a tool call that would change the Workspace or run a command. Resolved as allowed or denied.
_Avoid_: confirmation, approval dialog

**Edit**:
A change Claude made to a file in the Workspace during a Turn. Edits make files Dirty and appear in the Diff.
_Avoid_: patch, modification, write

**Auto-commit Switch**:
The control in the pane's head row, `auto-commit: on` or `off`, saying whether Claude may commit in the Workspace during the review. Off, a git commit is refused. Pushing and opening pull requests are never allowed unasked, whatever the switch says.
_Avoid_: commit mode, permission

**Side-by-side View**:
The way the pane draws a Diff when its `side-by-side` switch is on: the old file on the left, the new on the right, each change level with what it replaced. Off, the pane draws one column, deleted and added lines in turn. The choice belongs to the person, not the Review.
_Avoid_: split view, two-column mode

**Recent**:
A previously opened Review Target that can be reopened from the start screen.
