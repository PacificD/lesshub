import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function source(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

describe('M8 runner safety', () => {
  it('defers signal exit until partial report cleanup has completed', () => {
    for (const relativePath of [
      'apps/hono-react/scripts/run-e2e.mjs',
      'apps/hono-react/scripts/run-failure-gate.mjs'
    ]) {
      const value = source(relativePath)
      expect(value).toContain('requestedExitCode')
      expect(value).toContain('void cleanup()')
      expect(value).not.toContain('void cleanup().finally(() => process.exit')
      const signalHandler = value.match(/function handleSignal\(signal\) \{[\s\S]*?^\}/m)?.[0]
      expect(signalHandler).toBeDefined()
      expect(signalHandler).not.toContain('process.exit(')
    }
  })

  it('keeps the runbook shell examples explicitly bash-safe', () => {
    const runbook = source('docs/hono-react-rendering-poc/runbook.md')
    expect(runbook).not.toContain('```sh')
    expect(runbook).toContain('```bash')
    expect(runbook).toContain('umask 077')
    expect(runbook).toContain('mktemp')
    expect(runbook).toContain('trap')
  })

  it('keeps the implementation plan aligned with the completed M8 stage', () => {
    const plan = source('docs/hono-react-rendering-poc/plan.md')
    expect(plan).toContain('状态：M0–M8 已完成；最终独立审查通过')
    expect(plan).toContain('M8 独立审查已完成')
  })
})
