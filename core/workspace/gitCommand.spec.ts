import assert from "node:assert/strict";
import { test } from "node:test";

import { isGitCommit } from "./gitCommand.ts";

test("a git commit is found behind options and in a chain", () => {
  for (const command of [
    "git commit -m x",
    "git commit --amend --no-edit",
    "cd pkg && git -c user.name=x commit -m y",
    "git -C /repo commit",
    "git --git-dir .git commit",
    "git add -A; git commit -m 'all'",
    "git add -A\ngit commit -m all",
  ]) {
    assert.equal(isGitCommit(command), true, command);
  }
});

test("other git commands and other programs are not commits", () => {
  for (const command of ["git log --grep commit", "git show HEAD", "git status", "echo commit", "gh pr view", "npm run commit", "git -c x=y"]) {
    assert.equal(isGitCommit(command), false, command);
  }
});
