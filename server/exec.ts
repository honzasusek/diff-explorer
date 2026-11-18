import { execFile } from "node:child_process";

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Exit codes to treat as success (stdout is still returned). */
  okCodes?: number[];
}

export class ExecError extends Error {
  constructor(
    message: string,
    public readonly code: number | null,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

export function exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        maxBuffer: 512 * 1024 * 1024,
        env: { ...process.env, ...opts.env },
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : null;
          if (code !== null && opts.okCodes?.includes(code)) {
            resolve(stdout);
            return;
          }
          const detail = (stderr || err.message || "").trim();
          reject(new ExecError(`${cmd} ${args.join(" ")} failed: ${detail}`, code, stdout, stderr));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
