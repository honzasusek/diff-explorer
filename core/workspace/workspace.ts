// The Workspace: the session's checkout, a Base to diff against, and the
// Diff of the working tree against it. Everything git and gh is hidden here
// and reaches the outside only through the Runner port.
import type { Diff, DiffFile, PRMeta, WorkspaceInfo } from "../types.ts";
import type { Runner, RunResult } from "./runner.ts";
import type { Target } from "./target.ts";
import { WorkspaceError } from "./errors.ts";
import { buildDiff, fileId, parseUnifiedDiff } from "../diff/parser.ts";

export interface OpenOptions {
  /** The ref to measure the Diff from; default origin/HEAD, then main, then master. For PRs, origin/<base branch>. */
  baseRef?: string;
}

export interface Workspace {
  /** Checks the target out in place (PRs and branches) and resolves Base and Head. Idempotent. */
  open(target: Target, opts?: OpenOptions): Promise<WorkspaceInfo>;
  /** The working tree against Base: never cached, Dirty Files flagged, untracked files included as added. */
  diff(): Promise<Diff>;
  /** Restores a Dirty File to the committed Head, or deletes it when untracked. */
  revert(path: string): Promise<void>;
}

const GIT = ["git", "-c", "core.quotePath=false"];
const SLOW_MS = 600_000;
const DIFF_MS = 120_000;
const PR_FIELDS = "number,title,body,author,url,baseRefName,headRefName,headRefOid,state,isDraft,additions,deletions,changedFiles";
const BASE_CANDIDATES = ["origin/HEAD", "main", "master"];

interface StatusEntry {
  x: string;
  y: string;
  path: string;
  /** The original path of a rename or copy. */
  from: string | null;
}

interface RunOpts {
  cwd?: string;
  /** Exit codes that are not failures. */
  ok?: number[];
  timeoutMs?: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

function failure(argv: readonly string[], res: RunResult): WorkspaceError {
  const text = (res.stderr || res.stdout).trim();
  const cmd = argv
    .filter((a) => a !== "-c" && a !== "core.quotePath=false")
    .slice(0, 3)
    .join(" ");
  if (argv[0] === "gh") {
    if (res.exitCode === 4 || /not logged in|gh auth login|authentication/i.test(text)) {
      return new WorkspaceError("GhNotAuthenticated", "gh is not logged in: run `gh auth login`", text);
    }
    if (/no git remotes|none of the git remotes|not a git repository/i.test(text)) {
      return new WorkspaceError("NoGitHubRemote", "this repository has no GitHub remote", text);
    }
    if (/could not resolve|no pull requests found|not found|could not find/i.test(text)) {
      return new WorkspaceError("TargetNotFound", "no such pull request", text);
    }
    return new WorkspaceError("GitFailed", `${cmd} failed: ${firstLine(text)}`, text);
  }
  if (/not a git repository/i.test(text)) {
    return new WorkspaceError("NotAGitRepo", "not inside a git repository", text);
  }
  return new WorkspaceError("GitFailed", `${cmd} failed: ${firstLine(text)}`, text);
}

/** `git status --porcelain=v1 -z`: "XY path" entries, renames followed by their source. */
function parseStatus(out: string): StatusEntry[] {
  const parts = out.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (part.length < 4) continue;
    const x = part[0] ?? " ";
    const y = part[1] ?? " ";
    const path = part.slice(3);
    let from: string | null = null;
    if (x === "R" || x === "C" || y === "R" || y === "C") from = parts[++i] ?? null;
    entries.push({ x, y, path, from });
  }
  return entries;
}

function str(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function num(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  return typeof v === "number" ? v : 0;
}

function toPrMeta(raw: unknown): PRMeta {
  if (typeof raw !== "object" || raw === null) throw new WorkspaceError("GitFailed", "gh returned no pull request");
  const o = raw as Record<string, unknown>;
  const url = str(o, "url");
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  const author = o["author"];
  return {
    owner: m?.[1] ?? "",
    repo: m?.[2] ?? "",
    number: num(o, "number") || Number(m?.[3] ?? 0),
    title: str(o, "title"),
    body: str(o, "body"),
    author: typeof author === "object" && author !== null ? str(author as Record<string, unknown>, "login") : "",
    url,
    baseRefName: str(o, "baseRefName"),
    headRefName: str(o, "headRefName"),
    headRefOid: str(o, "headRefOid"),
    state: str(o, "state"),
    isDraft: o["isDraft"] === true,
    additions: num(o, "additions"),
    deletions: num(o, "deletions"),
    changedFiles: num(o, "changedFiles"),
  };
}

function repoFlag(target: Target & { kind: "pr" }): string[] {
  return target.owner && target.repo ? ["--repo", `${target.owner}/${target.repo}`] : [];
}

function byPath(a: DiffFile, b: DiffFile): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export function createWorkspace(runner: Runner, cwd: string, opened?: WorkspaceInfo): Workspace {
  let info: WorkspaceInfo | undefined = opened;
  let root: string | undefined = opened?.dir;

  async function run(argv: string[], opts: RunOpts = {}): Promise<RunResult> {
    let res: RunResult;
    try {
      res = await runner.run(argv, { cwd: opts.cwd ?? root ?? cwd, timeoutMs: opts.timeoutMs });
    } catch (err) {
      const tool = argv[0] ?? "command";
      throw new WorkspaceError(tool === "gh" ? "GhNotInstalled" : "GitFailed", `${tool} could not run: ${messageOf(err)}`);
    }
    if (res.exitCode !== 0 && !(opts.ok ?? []).includes(res.exitCode)) throw failure(argv, res);
    return res;
  }

  const git = (args: string[], opts?: RunOpts): Promise<RunResult> => run([...GIT, ...args], opts);
  const out = async (args: string[], opts?: RunOpts): Promise<string> => (await git(args, opts)).stdout.trim();

  async function status(): Promise<StatusEntry[]> {
    return parseStatus((await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout);
  }

  async function ensureCleanFor(branch: string): Promise<void> {
    const current = await out(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (current === branch) return;
    if ((await status()).length > 0) {
      throw new WorkspaceError(
        "DirtyCheckout",
        `the working tree on ${current} has uncommitted changes; commit or stash them first, or run /explore . to review the working tree`,
      );
    }
  }

  async function defaultBase(): Promise<string> {
    for (const ref of BASE_CANDIDATES) {
      const res = await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { ok: [1] });
      if (res.exitCode === 0) return ref;
    }
    throw new WorkspaceError("GitFailed", `no base ref found (tried ${BASE_CANDIDATES.join(", ")}); pass one`);
  }

  async function mergeBase(baseRef: string): Promise<string> {
    const res = await git(["merge-base", baseRef, "HEAD"], { ok: [1, 128] });
    if (res.exitCode !== 0) {
      throw new WorkspaceError("TargetNotFound", `no merge base between ${baseRef} and HEAD`, res.stderr.trim());
    }
    return res.stdout.trim();
  }

  async function viewPr(target: Target & { kind: "pr" }): Promise<PRMeta> {
    const res = await run(["gh", "pr", "view", String(target.number), "--json", PR_FIELDS, ...repoFlag(target)], {
      timeoutMs: DIFF_MS,
    });
    let raw: unknown;
    try {
      raw = JSON.parse(res.stdout);
    } catch {
      throw new WorkspaceError("GitFailed", "gh pr view returned something that is not JSON", res.stdout);
    }
    return toPrMeta(raw);
  }

  /** Checks the PR's head out. `gh pr checkout` wants the head branch, which is
   * gone once a merged PR's branch is deleted; GitHub still serves
   * `refs/pull/N/head`, so that case fetches it and checks it out detached. */
  async function checkoutPr(target: Target & { kind: "pr" }, pr: PRMeta): Promise<void> {
    const argv = ["gh", "pr", "checkout", String(pr.number), ...repoFlag(target)];
    const res = await run(argv, { timeoutMs: SLOW_MS, ok: [1] });
    if (res.exitCode === 0) return;
    if (!/couldn't find remote ref/i.test(res.stderr)) throw failure(argv, res);
    const remote = target.owner === undefined ? "origin" : `https://github.com/${pr.owner}/${pr.repo}.git`;
    await git(["fetch", "--quiet", remote, `refs/pull/${pr.number}/head`], { timeoutMs: SLOW_MS });
    await git(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  }

  async function open(target: Target, opts: OpenOptions = {}): Promise<WorkspaceInfo> {
    root = await out(["rev-parse", "--show-toplevel"], { cwd });
    let kind: WorkspaceInfo["kind"];
    let key: string;
    let baseRef: string;
    let pr: PRMeta | undefined;
    if (target.kind === "pr") {
      pr = await viewPr(target);
      await ensureCleanFor(pr.headRefName);
      await checkoutPr(target, pr);
      await git(["fetch", "--quiet", "origin", pr.baseRefName], { timeoutMs: SLOW_MS });
      baseRef = opts.baseRef ?? `origin/${pr.baseRefName}`;
      kind = "pr";
      key = `pr:${pr.owner}/${pr.repo}#${pr.number}`;
    } else {
      if (target.kind === "branch") {
        await ensureCleanFor(target.name);
        await git(["checkout", "--quiet", target.name]);
      }
      baseRef = opts.baseRef ?? (await defaultBase());
      kind = "local";
      key = `local:${root}`;
    }
    const baseSha = await mergeBase(baseRef);
    const headSha = await out(["rev-parse", "HEAD"]);
    info = { key, kind, dir: root, baseRef, baseSha, headSha, ...(pr ? { pr } : {}) };
    return info;
  }

  async function diff(): Promise<Diff> {
    if (!info) throw new WorkspaceError("GitFailed", "no target is open");
    const patch = await git(["diff", "--no-color", "--no-ext-diff", "-M", "-U3", info.baseSha], { timeoutMs: DIFF_MS });
    const files = parseUnifiedDiff(patch.stdout);
    const entries = await status();
    const dirty = new Set<string>();
    for (const e of entries) {
      dirty.add(e.path);
      if (e.from) dirty.add(e.from);
    }
    for (const e of entries) {
      if (e.x !== "?") continue;
      const res = await git(["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", e.path], { ok: [1] });
      const file: DiffFile = parseUnifiedDiff(res.stdout)[0] ?? {
        id: fileId(e.path),
        oldPath: null,
        newPath: e.path,
        path: e.path,
        status: "added",
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
      };
      file.status = "added";
      file.oldPath = null;
      files.push(file);
    }
    for (const f of files) {
      if (dirty.has(f.path) || (f.oldPath !== null && dirty.has(f.oldPath))) f.dirty = true;
    }
    files.sort(byPath);
    return buildDiff(files);
  }

  async function revert(path: string): Promise<void> {
    if (!root) root = await out(["rev-parse", "--show-toplevel"], { cwd });
    const entry = (await status()).find((e) => e.path === path || e.from === path);
    if (!entry) throw new WorkspaceError("NotDirty", `${path} has no uncommitted changes`);
    if (entry.x === "?") {
      await git(["clean", "--force", "-d", "--quiet", "--", entry.path]);
      return;
    }
    if (entry.from !== null) {
      await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", entry.from]);
      await git(["rm", "--force", "--quiet", "--", entry.path]);
      return;
    }
    if (entry.x === "A") {
      await git(["rm", "--force", "--quiet", "--", entry.path]);
      return;
    }
    await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", entry.path]);
  }

  return { open, diff, revert };
}
