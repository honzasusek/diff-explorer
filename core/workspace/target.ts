// What `/pr <text>` names. Mirrored in types/index.d.ts, which must stay
// self-contained, so keep the two in step.
export type Target =
  | { kind: "pr"; number: number; owner?: string; repo?: string }
  | { kind: "branch"; name: string }
  | { kind: "worktree" };

const PR_URL_RE = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const OWNER_REPO_RE = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

/** Parses the text after `/pr`. Returns undefined for empty or unusable input. */
export function parseTarget(text: string): Target | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  if (t === ".") return { kind: "worktree" };
  const bare = /^#?(\d+)$/.exec(t);
  if (bare) return { kind: "pr", number: Number(bare[1]) };
  const url = PR_URL_RE.exec(t);
  if (url) return { kind: "pr", number: Number(url[3]), owner: url[1], repo: url[2] };
  const short = OWNER_REPO_RE.exec(t);
  if (short) return { kind: "pr", number: Number(short[3]), owner: short[1], repo: short[2] };
  if (REF_RE.test(t) && !t.endsWith("/") && !t.includes("..")) return { kind: "branch", name: t };
  return undefined;
}

export function describeTarget(target: Target): string {
  switch (target.kind) {
    case "pr":
      return target.owner ? `PR ${target.owner}/${target.repo}#${target.number}` : `PR #${target.number}`;
    case "branch":
      return `branch ${target.name}`;
    case "worktree":
      return "working tree";
  }
}
