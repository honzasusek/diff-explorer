import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeRunner } from "../../node/runner.ts";
import type { Runner, RunOptions, RunResult } from "./runner.ts";
import { createWorkspace } from "./workspace.ts";
import { WorkspaceError } from "./errors.ts";

const dirs: string[] = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function sh(cwd: string, ...argv: string[]): Promise<string> {
  const res = await nodeRunner.run(argv, { cwd });
  if (res.exitCode !== 0) throw new Error(`${argv.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

/** A bare origin with main and feature, cloned into `work` (on main). */
async function makeRepos(): Promise<{ work: string }> {
  const dir = mkdtempSync(join(tmpdir(), "diff-explorer-"));
  dirs.push(dir);
  const origin = join(dir, "origin.git");
  const seed = join(dir, "seed");
  const work = join(dir, "work");
  await sh(dir, "git", "init", "--quiet", "--bare", "--initial-branch=main", origin);
  mkdirSync(seed);
  await sh(seed, "git", "init", "--quiet", "--initial-branch=main");
  await sh(seed, "git", "config", "user.email", "t@example.com");
  await sh(seed, "git", "config", "user.name", "t");
  writeFileSync(join(seed, "a.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(seed, "b.txt"), "bee\n");
  writeFileSync(join(seed, "keep.txt"), "keep\n");
  await sh(seed, "git", "add", "-A");
  await sh(seed, "git", "commit", "--quiet", "-m", "base");
  await sh(seed, "git", "checkout", "--quiet", "-b", "feature");
  writeFileSync(join(seed, "a.txt"), "one\ntwo\nthree\nfour\n");
  await sh(seed, "git", "mv", "b.txt", "c.txt");
  writeFileSync(join(seed, "new.txt"), "new\n");
  await sh(seed, "git", "add", "-A");
  await sh(seed, "git", "commit", "--quiet", "-m", "feature work");
  await sh(seed, "git", "remote", "add", "origin", origin);
  await sh(seed, "git", "push", "--quiet", "origin", "main", "feature");
  await sh(dir, "git", "clone", "--quiet", origin, work);
  await sh(work, "git", "config", "user.email", "t@example.com");
  await sh(work, "git", "config", "user.name", "t");
  return { work };
}

function code(expected: string): (err: unknown) => boolean {
  return (err) => {
    assert.ok(err instanceof WorkspaceError, `expected a WorkspaceError, got ${String(err)}`);
    assert.equal(err.code, expected, err.message);
    return true;
  };
}

const PR_JSON = JSON.stringify({
  number: 7,
  title: "Add four",
  body: "",
  author: { login: "octo" },
  url: "https://github.com/acme/widgets/pull/7",
  baseRefName: "main",
  headRefName: "feature",
  headRefOid: "",
  state: "OPEN",
  isDraft: false,
  additions: 2,
  deletions: 0,
  changedFiles: 3,
});

/** The real runner for git, canned answers for gh. */
function withGh(gh: (argv: readonly string[], opts: RunOptions) => Promise<RunResult>, calls: string[][] = []): Runner {
  return {
    run(argv, opts = {}) {
      calls.push([...argv]);
      return argv[0] === "gh" ? gh(argv, opts) : nodeRunner.run(argv, opts);
    },
  };
}

test("worktree target: the feature branch against origin/HEAD", async () => {
  const { work } = await makeRepos();
  await sh(work, "git", "checkout", "--quiet", "feature");
  const ws = createWorkspace(nodeRunner, work);
  const info = await ws.open({ kind: "worktree" });
  assert.equal(info.kind, "local");
  assert.equal(info.key, `local:${realpathSync(work)}`);
  assert.equal(info.baseRef, "origin/HEAD");
  assert.equal(info.baseSha, await sh(work, "git", "rev-parse", "origin/main"));
  assert.equal(info.headSha, await sh(work, "git", "rev-parse", "feature"));
  const diff = await ws.diff();
  assert.deepEqual(
    diff.files.map((f) => [f.path, f.status, f.oldPath, f.dirty ?? false]),
    [
      ["a.txt", "modified", "a.txt", false],
      ["c.txt", "renamed", "b.txt", false],
      ["new.txt", "added", null, false],
    ],
  );
  assert.deepEqual([diff.additions, diff.deletions], [2, 0]);
});

test("an explicit base ref is used as given", async () => {
  const { work } = await makeRepos();
  await sh(work, "git", "checkout", "--quiet", "feature");
  const info = await createWorkspace(nodeRunner, work).open({ kind: "worktree" }, { baseRef: "main" });
  assert.equal(info.baseRef, "main");
  assert.equal(info.baseSha, await sh(work, "git", "rev-parse", "main"));
});

test("uncommitted edits, renames and untracked files are dirty; untracked ones are synthesised", async () => {
  const { work } = await makeRepos();
  await sh(work, "git", "checkout", "--quiet", "feature");
  writeFileSync(join(work, "a.txt"), "one\ntwo\nthree\nfour\nfive\n");
  await sh(work, "git", "mv", "c.txt", "d.txt");
  writeFileSync(join(work, "scratch.txt"), "s1\ns2\n");
  writeFileSync(join(work, "empty.txt"), "");
  mkdirSync(join(work, "sub"));
  writeFileSync(join(work, "sub", "deep.txt"), "deep\n");
  const ws = createWorkspace(nodeRunner, work);
  await ws.open({ kind: "worktree" });
  const diff = await ws.diff();
  assert.deepEqual(
    diff.files.map((f) => [f.path, f.status, f.oldPath, f.dirty ?? false, f.additions]),
    [
      ["a.txt", "modified", "a.txt", true, 2],
      ["d.txt", "renamed", "b.txt", true, 0],
      ["empty.txt", "added", null, true, 0],
      ["new.txt", "added", null, false, 1],
      ["scratch.txt", "added", null, true, 2],
      ["sub/deep.txt", "added", null, true, 1],
    ],
  );
  const scratch = diff.files.find((f) => f.path === "scratch.txt")!;
  assert.deepEqual(
    scratch.hunks[0]!.lines.map((l) => [l.type, l.newNo, l.content]),
    [
      ["add", 1, "s1"],
      ["add", 2, "s2"],
    ],
  );
  assert.deepEqual(diff.files.find((f) => f.path === "empty.txt")!.hunks, []);
});

test("revert restores tracked edits, removes untracked files, undoes renames and refuses clean files", async () => {
  const { work } = await makeRepos();
  await sh(work, "git", "checkout", "--quiet", "feature");
  const ws = createWorkspace(nodeRunner, work);
  await ws.open({ kind: "worktree" });
  writeFileSync(join(work, "a.txt"), "changed\n");
  writeFileSync(join(work, "scratch.txt"), "s\n");
  await ws.revert("scratch.txt");
  assert.equal(existsSync(join(work, "scratch.txt")), false);
  await ws.revert("a.txt");
  assert.equal(readFileSync(join(work, "a.txt"), "utf8"), "one\ntwo\nthree\nfour\n");
  await assert.rejects(ws.revert("new.txt"), code("NotDirty"));
  await assert.rejects(ws.revert("missing.txt"), code("NotDirty"));
  await sh(work, "git", "mv", "c.txt", "d.txt");
  await ws.revert("d.txt");
  assert.equal(existsSync(join(work, "d.txt")), false);
  assert.equal(readFileSync(join(work, "c.txt"), "utf8"), "bee\n");
  assert.equal(await sh(work, "git", "status", "--porcelain"), "");
});

test("branch target checks the branch out, unless the tree is dirty", async () => {
  const { work } = await makeRepos();
  writeFileSync(join(work, "a.txt"), "dirty\n");
  await assert.rejects(createWorkspace(nodeRunner, work).open({ kind: "branch", name: "feature" }), code("DirtyCheckout"));
  assert.equal(await sh(work, "git", "rev-parse", "--abbrev-ref", "HEAD"), "main");
  await sh(work, "git", "checkout", "--quiet", "--", "a.txt");
  const info = await createWorkspace(nodeRunner, work).open({ kind: "branch", name: "feature" });
  assert.equal(await sh(work, "git", "rev-parse", "--abbrev-ref", "HEAD"), "feature");
  assert.equal(info.headSha, await sh(work, "git", "rev-parse", "origin/feature"));
});

test("pull request target: gh pr view, checkout in place, fetch of the base branch", async () => {
  const { work } = await makeRepos();
  const calls: string[][] = [];
  const runner = withGh(async (argv, opts) => {
    if (argv[1] === "pr" && argv[2] === "view") return { exitCode: 0, stdout: PR_JSON, stderr: "" };
    if (argv[1] === "pr" && argv[2] === "checkout") return nodeRunner.run(["git", "checkout", "--quiet", "feature"], opts);
    return { exitCode: 1, stdout: "", stderr: `unexpected gh call: ${argv.join(" ")}` };
  }, calls);
  const ws = createWorkspace(runner, work);
  const info = await ws.open({ kind: "pr", number: 7 });
  assert.equal(info.kind, "pr");
  assert.equal(info.key, "pr:acme/widgets#7");
  assert.equal(info.baseRef, "origin/main");
  assert.deepEqual([info.pr?.title, info.pr?.author, info.pr?.headRefName], ["Add four", "octo", "feature"]);
  assert.equal(await sh(work, "git", "rev-parse", "--abbrev-ref", "HEAD"), "feature");
  assert.ok(calls.some((c) => c[0] === "gh" && c[2] === "view" && c[3] === "7" && !c.includes("--repo")));
  assert.ok(calls.some((c) => c[0] === "gh" && c[2] === "checkout" && c[3] === "7"));
  assert.ok(calls.some((c) => c[0] === "git" && c.includes("fetch") && c.includes("main")));
  assert.equal((await ws.diff()).files.length, 3);

  const again: string[][] = [];
  await createWorkspace(withGh(async (argv, opts) => {
    if (argv[2] === "view") return { exitCode: 0, stdout: PR_JSON, stderr: "" };
    return nodeRunner.run(["git", "checkout", "--quiet", "feature"], opts);
  }, again), work).open({ kind: "pr", number: 7, owner: "acme", repo: "widgets" });
  assert.ok(again.some((c) => c[2] === "view" && c.includes("--repo") && c.includes("acme/widgets")));
});

test("a merged pull request whose branch is gone is fetched from refs/pull/N/head", async () => {
  const { work } = await makeRepos();
  const origin = await sh(work, "git", "remote", "get-url", "origin");
  await sh(origin, "git", "update-ref", "refs/pull/7/head", "feature");
  await sh(origin, "git", "branch", "--delete", "--force", "feature");
  const calls: string[][] = [];
  const runner = withGh(async (argv) => {
    if (argv[2] === "view") return { exitCode: 0, stdout: PR_JSON, stderr: "" };
    return { exitCode: 1, stdout: "", stderr: "fatal: couldn't find remote ref refs/heads/feature\nfailed to run git: exit status 128" };
  }, calls);
  const info = await createWorkspace(runner, work).open({ kind: "pr", number: 7 });
  assert.equal(info.headSha, await sh(origin, "git", "rev-parse", "refs/pull/7/head"));
  assert.equal(await sh(work, "git", "rev-parse", "--abbrev-ref", "HEAD"), "HEAD");
  assert.ok(calls.some((c) => c[0] === "git" && c.includes("fetch") && c.includes("origin") && c.includes("refs/pull/7/head")));
});

test("a dirty tree on another branch blocks a pull request checkout", async () => {
  const { work } = await makeRepos();
  writeFileSync(join(work, "a.txt"), "dirty\n");
  const runner = withGh(async () => ({ exitCode: 0, stdout: PR_JSON, stderr: "" }));
  await assert.rejects(createWorkspace(runner, work).open({ kind: "pr", number: 7 }), code("DirtyCheckout"));
});

test("gh failures map to workspace errors", async () => {
  const { work } = await makeRepos();
  const failing = (exitCode: number, stderr: string) =>
    createWorkspace(withGh(async () => ({ exitCode, stdout: "", stderr })), work).open({ kind: "pr", number: 7 });
  await assert.rejects(failing(4, "To get started with GitHub CLI, please run:  gh auth login"), code("GhNotAuthenticated"));
  await assert.rejects(failing(1, "GraphQL: Could not resolve to a PullRequest with the number of 7."), code("TargetNotFound"));
  await assert.rejects(failing(1, "none of the git remotes configured for this repository point to a known GitHub host"), code("NoGitHubRemote"));
  const missing: Runner = {
    run(argv, opts) {
      if (argv[0] === "gh") return Promise.reject(new Error("spawn gh ENOENT"));
      return nodeRunner.run(argv, opts);
    },
  };
  await assert.rejects(createWorkspace(missing, work).open({ kind: "pr", number: 7 }), code("GhNotInstalled"));
});

test("not a git repository", async () => {
  const dir = mkdtempSync(join(tmpdir(), "diff-explorer-plain-"));
  dirs.push(dir);
  await assert.rejects(createWorkspace(nodeRunner, dir).open({ kind: "worktree" }), code("NotAGitRepo"));
});

test("a workspace resumes from stored info without reopening", async () => {
  const { work } = await makeRepos();
  await sh(work, "git", "checkout", "--quiet", "feature");
  const info = await createWorkspace(nodeRunner, work).open({ kind: "worktree" });
  const resumed = createWorkspace(nodeRunner, work, info);
  assert.equal((await resumed.diff()).files.length, 3);
});

/** The real runner with stdout cut at `cap` bytes and flagged, as the engine's process call cuts a stream at 4 MiB. */
function capped(cap: number): Runner {
  return {
    async run(argv, opts) {
      const res = await nodeRunner.run(argv, opts);
      return res.stdout.length > cap ? { ...res, stdout: res.stdout.slice(0, cap), isStdoutTruncated: true } : res;
    },
  };
}

test("a patch the runner cuts is fetched per file; a file still cut keeps its counts and is marked", async () => {
  const { work } = await makeRepos();
  await sh(work, "git", "checkout", "--quiet", "feature");
  writeFileSync(join(work, "scratch.txt"), "s1\ns2\n");
  const whole = await createWorkspace(nodeRunner, work).open({ kind: "worktree" });
  const plain = await createWorkspace(nodeRunner, work, whole).diff();
  const size = (await nodeRunner.run(["git", "diff", "-M", "-U3", whole.baseSha], { cwd: work })).stdout.length;

  // Every file's own patch fits under the cap, so the Diff is the same.
  assert.deepEqual(await createWorkspace(capped(size - 1), work, whole).diff(), plain);

  // Under a cap no patch fits, each file keeps its counts and no hunks.
  const cut = await createWorkspace(capped(40), work, whole).diff();
  assert.deepEqual(
    cut.files.map((f) => [f.path, f.status, f.oldPath, f.additions, f.deletions, f.hunks.length, f.truncated ?? false]),
    [
      ["a.txt", "modified", "a.txt", 1, 0, 0, true],
      ["c.txt", "renamed", "b.txt", 0, 0, 0, true],
      ["new.txt", "added", null, 1, 0, 0, true],
      ["scratch.txt", "added", null, 0, 0, 0, true],
    ],
  );
  assert.deepEqual([cut.additions, cut.deletions], [2, 0]);
});
