# diff-explorer

A Claude Code mod that opens a pull request's or a branch's diff in a pane beside the chat, lets you pick lines out of it, and sends those lines with your prompt, so Claude explains or changes exactly them in the same checkout.

## What it does

- `/explore 412` checks the pull request out in place, measures the diff from its base branch and opens the pane: a header per file with its counts, every hunk drawn as a diff with line numbers, large files folded. `/explore .` reviews your working tree, `/explore <branch>` a branch.
- Pick lines three ways: drag across them in the pane and run `/add` (or press `[add selection]` in the band above the prompt); click a first and a last line number in the gutter; or type `#path:from-to` in the prompt, with typeahead after `#`. `+hunk` and `+file` take a whole hunk or file.
- Each pick is a chip above the prompt. Send a prompt and the chips go with it as `code_ref` blocks, numbered and marked as in the pane, after a lead-in saying they are the lines the request is about. While a review is open, Claude's system prompt names it: the target, its files, the base commit to run `git diff` against.
- When Claude edits a file of the checkout the pane refreshes: the file gets a dirty dot, and a chip whose lines changed reads `(stale)`. `/revert <path>` restores a file to its committed version after a confirmation.
- The pane's head row has an `auto-commit` switch. Off, a `git commit` Claude runs is refused with the reason. It starts off for a pull request, whose branch is someone else's, and on for your own tree or branch, and is remembered per repository. Pushing and opening pull requests are never allowed unasked, whatever the switch says.
- Beside it, `side-by-side` draws each hunk with the old file on the left and the new on the right, every change level with what it replaced. The choice is remembered for every repository and session.

- In the desktop app each hunk is drawn as one block of monospaced text with its line numbers written into every line, so they stay level with the code, and added and removed lines are tinted. TypeScript, JavaScript and JSON files get syntax colours from the mod's own highlighter: keywords, strings, numbers and comments, and keys in JSON. The app takes at most 100,000 characters per drawing and each coloured stretch costs some, so on a very large diff only the hunks at the top are coloured and the rest stay plain. To pick lines there, press `pick lines` on a hunk: it is drawn a line per row, and two presses on line numbers add the range.

Everything the mod knows lives in `core/`, plain TypeScript with no dependency on the engine, Node or a UI; `hooks/` wires it to Claude Code's events and draws the pane.

## Install

At the prompt of a terminal session:

```
/plugin install diff-explorer --marketplace honzasusek/diff-explorer
```

Answer `y` to add the marketplace, then choose a scope (user, the first, installs it for every project). From a shell, the same is `claude plugin install diff-explorer --marketplace honzasusek/diff-explorer`. In the desktop app, click `+` next to the prompt box, then Plugins, Add marketplace with `honzasusek/diff-explorer`, then Add plugin.

To run a checkout of this repository without installing it: `claude --plugin-dir <this folder>`.

Requirements: git; the GitHub CLI `gh`, logged in, for pull requests; Claude Code 2.1.319 or later. The mod API is declared per Claude Code build, so `claude plugin validate .` says whether a newer build still accepts the module.

## Commands

| Command | Does |
|---|---|
| `/explore <number \| url \| owner/repo#n \| branch \| .> [base ref]` | Open a pull request, a branch, or the working tree (`.`) against a base ref. With no argument, reopen the last target opened in this repository. |
| `/add` | Add the lines selected in the pane to the refs for the next prompt. |
| `/ref path:from-to [old]` | Add a typed range; `old` numbers it on the base side. |
| `/refs` | List the refs waiting for the next prompt; `/refs clear` empties them. |
| `/revert <path>` | Restore a file Claude edited to its committed version, after a confirmation. |

The pane scrolls with the wheel, or with the arrow keys and PageUp/PageDown once it has the keyboard (click it, or `ctrl+x tab`). In the terminal the head stays at the top while the diff scrolls under it, so the target, how many files are folded (`1/3 folded`) and both switches are always in view. Home and End jump to the diff's start and end. A chip press scrolls the pane to its lines; its `[x]` drops it.

## Options

In `/config`, under diff-explorer:

| Option | Default | Does |
|---|---|---|
| Default base ref | empty | What `/explore .` and `/explore <branch>` measure from when no base ref is typed. Empty tries `origin/HEAD`, then `main`, then `master`. A pull request keeps its own base branch. |
| Fold threshold | 1500 | Changed lines from which a file starts folded; 0 folds every file. |
| Inline pane rows | 0 | Body rows the pane asks for while it sits above the prompt, in a terminal under 110 columns. 0 leaves it to the layout. The dock beside a wide transcript ignores it. |

## Development

```
npm install
npm run check        # claude plugin validate, then tsc for core, the core specs and the mod
npm test             # the core specs, node --test
claude plugin test . # the mod's tests against the engine
claude --plugin-dir . # a session with the mod, reloading on save
```

`docs/PLAN.md` is the implementation plan, `GLOSSARY.md` the vocabulary, `docs/adr/` the decisions and `docs/research/claude-code-mod.md` the facts about the mod API the code relies on.
