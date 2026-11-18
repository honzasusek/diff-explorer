import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTarget, parseTarget } from "./target.ts";

test("parses the forms /pr accepts", () => {
  assert.deepEqual(parseTarget("412"), { kind: "pr", number: 412 });
  assert.deepEqual(parseTarget(" #412 "), { kind: "pr", number: 412 });
  assert.deepEqual(parseTarget("https://github.com/strvcom/some-repo/pull/412"), {
    kind: "pr",
    number: 412,
    owner: "strvcom",
    repo: "some-repo",
  });
  assert.deepEqual(parseTarget("https://github.com/strvcom/some-repo/pull/412/files#diff-1"), {
    kind: "pr",
    number: 412,
    owner: "strvcom",
    repo: "some-repo",
  });
  assert.deepEqual(parseTarget("strvcom/some-repo#7"), { kind: "pr", number: 7, owner: "strvcom", repo: "some-repo" });
  assert.deepEqual(parseTarget("feature/retry"), { kind: "branch", name: "feature/retry" });
  assert.deepEqual(parseTarget("."), { kind: "worktree" });
});

test("rejects empty and unusable input", () => {
  for (const text of ["", "   ", "-x", "a..b", "feature/", "not a ref", "https://example.com/pull/1"]) {
    assert.equal(parseTarget(text), undefined, JSON.stringify(text));
  }
});

test("describes a target for the transcript", () => {
  assert.equal(describeTarget({ kind: "pr", number: 412 }), "PR #412");
  assert.equal(describeTarget({ kind: "pr", number: 412, owner: "o", repo: "r" }), "PR o/r#412");
  assert.equal(describeTarget({ kind: "branch", name: "main" }), "branch main");
  assert.equal(describeTarget({ kind: "worktree" }), "working tree");
});
