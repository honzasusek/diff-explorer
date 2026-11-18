import { spawn } from "node:child_process";
import type { Runner, RunOptions, RunResult } from "../core/workspace/runner.ts";

/** The Runner port over child_process, for tests and any Node caller of core. */
export const nodeRunner: Runner = {
  run(argv: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
    const [cmd, ...args] = argv;
    if (!cmd) return Promise.reject(new Error("runner: empty argv"));
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: opts.timeoutMs ?? 30_000,
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        });
      });
      child.stdin.end(opts.stdin ?? "");
    });
  },
};
