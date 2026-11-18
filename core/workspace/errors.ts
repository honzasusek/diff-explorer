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
