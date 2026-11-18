---
status: superseded by ADR-0006
---

# Claude Agent SDK is the review engine

Claude has to read beyond the hunk, grep the repository, and edit files when asked, so it needs real tools against a real checkout. We drive every Turn through the Claude Agent SDK (`query()` with `cwd` set to the Workspace checkout) rather than the Messages API with hand-written file tools, because the SDK already ships Read/Grep/Glob/Edit/Bash, a permission model we can bridge to the browser, session resume for Conversation memory, and a codebase-tuned system prompt with caching.

## Considered options

- **Messages API + Tool Runner with our own tools.** Full control and no Claude Code dependency, but we would own file tools, path safety, permission prompting, context management and session persistence ourselves. Far more code for a worse version of what the SDK has.
- **Managed Agents.** Would need the checkout shipped to a remote sandbox. The local-repository Review Target rules it out, and it adds latency to every Turn.

## Consequences

- The app depends on the bundled Claude Code CLI the SDK spawns, and on the user's Claude auth. The SDK is on a fast-moving 0.x line, so it is pinned exactly and wrapped behind a single adapter.
- One `query()` per Turn, resumed by session id. Model and permission mode can change per Turn without managing a long-lived process.
- The Agent SDK is kept to the Reviewer module. Nothing else imports it.
