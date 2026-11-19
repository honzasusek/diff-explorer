// Whether a shell command Claude is about to run makes a git commit, for the
// guard that refuses commits while the pane's switch is off. The command is
// read segment by segment (`&&`, `||`, `;`, `|`, newlines), and in each the
// word after `git` and its options is the subcommand: `git commit -m x`,
// `cd pkg && git -c user.name=x commit`, `git -C /repo commit --amend` are
// commits; `git log --grep commit`, `git show HEAD`, `echo commit` are not.

/** Options that take a value in the next word. */
const WITH_VALUE = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

function isCommitSegment(segment: string): boolean {
  const words = segment.trim().split(/\s+/);
  const at = words.indexOf("git");
  if (at < 0) return false;
  for (let i = at + 1; i < words.length; i++) {
    const word = words[i] ?? "";
    if (WITH_VALUE.has(word)) {
      i += 1;
      continue;
    }
    if (word.startsWith("-")) continue;
    return word === "commit";
  }
  return false;
}

export function isGitCommit(command: string): boolean {
  return command.split(/&&|\|\||;|\||\n/).some(isCommitSegment);
}
