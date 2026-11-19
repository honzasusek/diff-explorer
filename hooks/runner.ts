import type { EngineInterface } from 'claude-code'

import type { Runner } from '../core/workspace/runner.ts'

/** The Runner port over the engine's process call: git and gh run where the session runs. */
export function engineRunner($: EngineInterface): Runner {
  return {
    async run(argv, opts = {}) {
      const { exitCode, stdout, stderr, isStdoutTruncated } = await $.process.run(argv, {
        cwd: opts.cwd,
        stdin: opts.stdin,
        timeoutMs: opts.timeoutMs,
      })

      return { exitCode, stdout, stderr, isStdoutTruncated }
    },
  }
}
