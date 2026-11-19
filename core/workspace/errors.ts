export type WorkspaceErrorCode =
  | "NotAGitRepo"
  | "NoGitHubRemote"
  | "GhNotInstalled"
  | "GhNotAuthenticated"
  | "TargetNotFound"
  | "DirtyCheckout"
  | "NotDirty"
  | "GitFailed";

/** Every failure a Workspace reports, with a code a UI can map to a hint. */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  /** The tool's own words (stderr), for logs. */
  readonly detail: string;

  constructor(code: WorkspaceErrorCode, message: string, detail = "") {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.detail = detail;
  }
}

/** What the person can do about an error, by code: null where the message
 * already says, or where only git's own words help. */
export function hintFor(code: WorkspaceErrorCode): string | null {
  switch (code) {
    case "NotAGitRepo":
      return "Start Claude Code inside the repository.";
    case "NoGitHubRemote":
      return "Add a GitHub remote, or review a branch or the working tree: /explore <branch>, /explore .";
    case "GhNotInstalled":
      return "Install the GitHub CLI (https://cli.github.com) and run `gh auth login`.";
    case "TargetNotFound":
      return "Check the number or the ref, and that the base branch is fetched.";
    default:
      return null;
  }
}

/** The words a toast or the transcript gives for an error: a Workspace
 * error's message and its hint, "not inside a git repository. Start Claude
 * Code inside the repository."; any other error's message alone. */
export function explainError(err: unknown): string {
  if (err instanceof WorkspaceError) {
    const hint = hintFor(err.code);
    return hint === null ? err.message : `${err.message}. ${hint}`;
  }
  return err instanceof Error ? err.message : String(err);
}
