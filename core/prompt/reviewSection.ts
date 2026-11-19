// The section the mod adds to the system prompt while a review is open: what
// the person is reviewing, which files the Diff holds, how a code_ref block
// reads, and that the checkout is theirs. The text stays the same from one
// turn to the next while the review is open, so it names paths and statuses
// and never counts or dirty marks: a changed section loses the prompt cache
// for the whole conversation.
//
// For the sample review (PR #412 "Retry charges", feature/retry against
// main, base commit base000) the section opens:
//
//   The person is reviewing PR #412 "Retry charges" (feature/retry against
//   main) in the diff-explorer pane beside this conversation. ...
//   Files in the diff:
//   - modified src/payments/client.ts
//   - added src/payments/retry.ts
import type { FileStatus } from "../types.ts";

export interface ReviewSummary {
  /** How the transcript names the target: "PR #412", "working tree". */
  label: string;
  title: string | null;
  /** The head branch, or the short head commit. */
  head: string;
  /** The base branch or ref. */
  base: string;
  baseSha: string;
  url: string | null;
  files: readonly { path: string; status: FileStatus }[];
  /** The pane's switch: whether Claude may commit in this checkout. */
  commits: boolean;
}

/** Files named one per line; past this many the rest is a count. */
const MAX_FILES = 150;

export const SECTION_ID = "diff-explorer:review";

const CODE_REF_HELP = [
  "The person's prompts may end with <code_ref> blocks: lines they selected in the pane, quoted as they stood when selected.",
  'Each block names the file, the side ("new" is the version under review, "old" the base version) and the line range on that side.',
  "Each row is the line's number on that side (blank for a line of the other side), a marker (+ added, - deleted, blank unchanged), a bar, then the line.",
  'A block with stale="true" holds lines that have changed since they were selected; read the file before relying on them.',
  "A request that carries code_ref blocks is about those lines: apply it there unless the request itself names a wider scope.",
].join(" ");

export function reviewSection(review: ReviewSummary): string {
  const title = review.title === null ? "" : ` "${review.title}"`;
  const url = review.url === null ? "" : ` Its page is ${review.url}.`;
  const shown = review.files.slice(0, MAX_FILES).map((f) => `- ${f.status} ${f.path}`);
  const more = review.files.length - shown.length;
  if (more > 0) shown.push(`- and ${more} more`);
  return [
    `The person is reviewing ${review.label}${title} (${review.head} against ${review.base}) in the diff-explorer pane beside this conversation.${url}`,
    `The diff is measured from commit ${review.baseSha}: \`git diff ${review.baseSha}\` shows it as it stands now, your own edits included.`,
    review.files.length === 0 ? "The diff holds no files." : ["Files in the diff:", ...shown].join("\n"),
    CODE_REF_HELP,
    review.commits
      ? "This checkout is the person's review. Commits in it are allowed, by the auto-commit switch in the diff pane; do not push or open a pull request unless they ask."
      : "This checkout is the person's review. Do not commit in it: the auto-commit switch in the diff pane is off, and a git commit is refused. Do not push or open a pull request unless they ask.",
  ].join("\n\n");
}
