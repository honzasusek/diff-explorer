// The one port out of core: how a Workspace runs git and gh. Two adapters
// satisfy it: hooks/runner.ts over $.process.run inside the mod, and
// node/runner.ts over child_process for tests and the parked terminal app.

export interface RunOptions {
  cwd?: string;
  /** Text written to the child's standard input, then closed. */
  stdin?: string;
  timeoutMs?: number;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when the adapter cut stdout at its cap (the engine's process call
   * keeps 4 MiB of a stream); what was cut is gone, not waiting. */
  isStdoutTruncated?: boolean;
}

export interface Runner {
  run(argv: readonly string[], opts?: RunOptions): Promise<RunResult>;
}
