import assert from "node:assert/strict";
import { test } from "node:test";

import { reviewSection } from "./reviewSection.ts";
import type { ReviewSummary } from "./reviewSection.ts";

const review: ReviewSummary = {
  label: "PR #412",
  title: "Retry charges",
  head: "feature/retry",
  base: "main",
  baseSha: "base000",
  url: "https://github.com/acme/pay/pull/412",
  files: [
    { path: "src/payments/client.ts", status: "modified" },
    { path: "src/payments/retry.ts", status: "added" },
  ],
  commits: false,
};

test("the section names the review, the base commit, the files and the code_ref format", () => {
  const text = reviewSection(review);
  assert.ok(
    text.startsWith(
      'The person is reviewing PR #412 "Retry charges" (feature/retry against main) in the diff-explorer pane beside this conversation. Its page is https://github.com/acme/pay/pull/412.',
    ),
  );
  assert.ok(text.includes("`git diff base000`"));
  assert.ok(text.includes("Files in the diff:\n- modified src/payments/client.ts\n- added src/payments/retry.ts\n\n"));
  assert.ok(text.includes("<code_ref> blocks"));
  assert.ok(text.includes('stale="true"'));
  assert.ok(text.includes("apply it there unless the request itself names a wider scope."));
  assert.ok(text.endsWith("Do not commit in it: the auto-commit switch in the diff pane is off, and a git commit is refused. Do not push or open a pull request unless they ask."));
  assert.ok(reviewSection({ ...review, commits: true }).endsWith("Commits in it are allowed, by the auto-commit switch in the diff pane; do not push or open a pull request unless they ask."));
});

test("a local target has no title or page; many files end in a count", () => {
  const files = Array.from({ length: 160 }, (_, i) => ({ path: `f${i}.ts`, status: "modified" as const }));
  const text = reviewSection({ ...review, title: null, url: null, label: "working tree", head: "42c4528", files });
  assert.ok(text.startsWith("The person is reviewing working tree (42c4528 against main) in the diff-explorer pane beside this conversation.\n"));
  assert.ok(text.includes("- modified f149.ts\n- and 10 more\n"));
  assert.ok(!text.includes("f150.ts"));
  assert.ok(reviewSection({ ...review, files: [] }).includes("The diff holds no files."));
});
