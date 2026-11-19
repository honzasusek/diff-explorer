import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceError, explainError } from "./errors.ts";

test("a workspace error is explained with its hint; other errors by their message", () => {
  assert.equal(
    explainError(new WorkspaceError("NotAGitRepo", "not inside a git repository", "fatal: ...")),
    "not inside a git repository. Start Claude Code inside the repository.",
  );
  assert.equal(
    explainError(new WorkspaceError("GhNotAuthenticated", "gh is not logged in: run `gh auth login`")),
    "gh is not logged in: run `gh auth login`",
  );
  assert.equal(explainError(new Error("boom")), "boom");
  assert.equal(explainError("plain"), "plain");
});
