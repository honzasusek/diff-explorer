// What /explore reopens with no argument: the last target opened in a
// repository, kept in the mod's store across sessions as one record keyed by
// the repository's root directory. The record for a session is the one whose
// root is the session's directory or holds it: with `{ "/work/pay": ... }`
// both "/work/pay" and "/work/pay/src" find it and "/work/payroll" does not.
import type { Target } from "./target.ts";

export interface Remembered {
  target: Target;
  /** The base ref given on the command line, else null for the default. */
  baseRef: string | null;
}

export type RecentReviews = Record<string, Remembered>;

/** Whether `path` is `dir` or lies under it: "/a/b" is inside "/a" and not inside "/ab". */
export function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

function isTarget(value: unknown): value is Target {
  if (typeof value !== "object" || value === null) return false;
  const t = value as { kind?: unknown; number?: unknown; name?: unknown };
  return (t.kind === "pr" && typeof t.number === "number") || (t.kind === "branch" && typeof t.name === "string") || t.kind === "worktree";
}

/** The store's value read back: a record of well-formed entries, anything
 * else (unset, an older shape) as empty, so a bad store never breaks /explore. */
export function recentReviews(stored: unknown): RecentReviews {
  const out: RecentReviews = {};
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return out;
  for (const [dir, entry] of Object.entries(stored)) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as { target?: unknown; baseRef?: unknown };
    if (isTarget(e.target) && (e.baseRef === null || typeof e.baseRef === "string")) out[dir] = { target: e.target, baseRef: e.baseRef };
  }
  return out;
}

/** The record of the repository holding `cwd`: the longest root that is `cwd` or above it. */
export function recentFor(recent: RecentReviews, cwd: string): Remembered | undefined {
  let best: string | undefined;
  for (const dir of Object.keys(recent)) {
    if (isInside(cwd, dir) && (best === undefined || dir.length > best.length)) best = dir;
  }
  return best === undefined ? undefined : recent[best];
}

export function remember(recent: RecentReviews, dir: string, entry: Remembered): RecentReviews {
  return { ...recent, [dir]: entry };
}
