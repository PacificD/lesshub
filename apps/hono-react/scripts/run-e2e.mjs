import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '../..')
const timestamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
const runId = randomBytes(4).toString('hex')
const testResultsRoot = resolve(repoRoot, 'test-results')
const resultRoot = resolve(testResultsRoot, `${timestamp}-${runId}`)
const composeProject = `lesshub-e2e-${runId}`
const internalToken = randomBytes(32).toString('hex')
const sessionSecret = randomBytes(32).toString('hex')
const dockerContext = process.env.DOCKER_CONTEXT
const composeFile = resolve(repoRoot, 'compose.rendering-poc.yml')

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate an E2E port'))
        return
      }
      const { port } = address
      server.close(error => (error ? reject(error) : resolvePort(port)))
    })
  })
}

let activeChild
let cancelled = false
let requestedExitCode = 0
let composeStarted = false
let cleanupPromise

async function run(command, args, options = {}) {
  return await new Promise((resolveRun, reject) => {
    const capture = options.logPath ? createWriteStream(options.logPath, { flags: 'a' }) : undefined
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    })
    activeChild = child
    if (capture) {
      for (const stream of [child.stdout, child.stderr])
        stream?.on('data', chunk => { process.stdout.write(chunk); capture.write(chunk) })
    }
    child.once('error', error => { if (activeChild === child) activeChild = undefined; reject(error) })
    child.once('exit', (code, signal) => {
      if (activeChild === child) activeChild = undefined
      capture?.end()
      if (code === 0) resolveRun()
      else reject(new Error(`${command} exited with ${code ?? signal ?? 'unknown'}`))
    })
  })
}

await mkdir(testResultsRoot, { recursive: true })
await mkdir(resultRoot, { recursive: false })
const testLog = resolve(resultRoot, 'test.log')
await writeFile(testLog, '')
const [pagePort, commercePort, redisPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort()
])
const environment = {
  ...process.env,
  E2E_RESULTS_DIR: resultRoot,
  E2E_PAGE_PORT: String(pagePort),
  E2E_COMMERCE_PORT: String(commercePort),
  E2E_REDIS_PORT: String(redisPort),
  REDIS_PORT: String(redisPort),
  REDIS_URL: `redis://127.0.0.1:${redisPort}`,
  E2E_INTERNAL_TOKEN: internalToken,
  E2E_SESSION_SECRET: sessionSecret,
  E2E_COMPOSE_PROJECT: composeProject
}
const dockerArgs = [
  ...(dockerContext ? ['--context', dockerContext] : []),
  'compose',
  '-p',
  composeProject,
  '-f',
  composeFile
]

async function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    activeChild?.kill('SIGTERM')
    if (composeStarted) {
      await run('docker', [...dockerArgs, 'down', '--volumes', '--remove-orphans'], {
        env: environment,
        logPath: testLog
      }).catch(error => console.error(`Redis cleanup failed: ${error.message}`))
      composeStarted = false
    }
  })()
  return cleanupPromise
}

function handleSignal(signal) {
  if (cancelled) return
  cancelled = true
  requestedExitCode = signal === 'SIGINT' ? 130 : 143
  // Stop the active child, but let the main try/catch/finally write its
  // partial report before the single top-level exit below.
  void cleanup()
}
process.once('SIGINT', handleSignal)
process.once('SIGTERM', handleSignal)

let exitCode = 0
try {
  await run('corepack', ['pnpm', '--filter', '@lesshub/commerce-api', 'build'], { logPath: testLog })
  await run('corepack', ['pnpm', '--filter', '@lesshub/hono-react', 'build'], { logPath: testLog })
  // Mark the compose lifecycle before spawning docker so cancellation during
  // `up --wait` still reaches the idempotent cleanup/down path.
  composeStarted = true
  await run('docker', [...dockerArgs, 'up', '-d', '--wait'], { env: environment, logPath: testLog })
  await run('corepack', ['pnpm', 'exec', 'playwright', 'test', ...process.argv.slice(2)], {
    cwd: appRoot,
    env: environment,
    logPath: testLog
  })
  await run('node', ['scripts/run-failure-gate.mjs'], {
    cwd: appRoot,
    env: environment,
    logPath: testLog
  })
} catch (error) {
  exitCode = 1
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  await appendFile(testLog, `${new Date().toISOString()} runner-error ${message}\n`).catch(() => {})
} finally {
  await cleanup()
  if (cancelled) exitCode = requestedExitCode
  const jsonPath = resolve(resultRoot, 'results.json')
  const failureGatePath = resolve(resultRoot, 'failure-gate.json')
  let failureGate = 'not-run'
  try {
    const gate = JSON.parse(await readFile(failureGatePath, 'utf8'))
    failureGate = gate.passed ? 'passed' : `failed: ${gate.error ?? 'unknown error'}`
  } catch { /* preserve a partial report when the gate did not start */ }
  let summary = 'JSON results were not produced; this is a partial E2E run.'
  try {
    const report = JSON.parse(await readFile(jsonPath, 'utf8'))
    const counts = { passed: 0, failed: 0, skipped: 0, timedOut: 0 }
    const walk = suites => { for (const suite of suites ?? []) { for (const spec of suite.specs ?? []) { for (const test of spec.tests ?? []) { const status = test.results?.at(-1)?.status ?? test.status; if (status === 'passed') counts.passed += 1; else if (status === 'skipped') counts.skipped += 1; else if (status === 'timedOut') counts.timedOut += 1; else counts.failed += 1 } } walk(suite.suites) } }
    walk(report.suites)
    summary = `passed=${counts.passed}, failed=${counts.failed}, skipped=${counts.skipped}, timedOut=${counts.timedOut}`
  } catch { /* preserve partial artifacts when the runner failed before JSON output */ }
  await writeFile(resolve(resultRoot, 'e2e-report.md'), [
    '# E2E report',
    '',
    `Run: ${resultRoot.split('/').at(-1)}`,
    '',
    summary,
    `Failure gate: ${failureGate}`,
    '',
    'Artifacts: junit.xml, results.json, failure-gate.json, test.log, and failure traces/screenshots when present.'
  ].join('\n') + '\n')
  console.log(`E2E_RESULTS_DIR=${resultRoot}`)
}

process.exit(exitCode)
