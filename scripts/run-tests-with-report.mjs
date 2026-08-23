import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
const resultRoot = resolve(repoRoot, 'test-results', `${stamp}-${randomBytes(4).toString('hex')}`)
async function discoverWorkspaces() {
  const workspaces = []
  for (const group of ['apps', 'packages']) {
    const root = resolve(repoRoot, group)
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const relative = `${group}/${entry.name}`
      const manifestPath = resolve(repoRoot, relative, 'package.json')
      let manifest
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      workspaces.push({
        name: manifest.name ?? relative,
        relative,
        testScript: typeof manifest.scripts?.test === 'string' ? manifest.scripts.test : null
      })
    }
  }
  return workspaces.sort((left, right) => left.relative.localeCompare(right.relative))
}
const packageReports = await discoverWorkspaces()
const logPath = resolve(resultRoot, 'test.log')

await mkdir(resultRoot, { recursive: true })
let logQueue = Promise.resolve()
const log = chunk => {
  const text = String(chunk)
  process.stdout.write(text)
  logQueue = logQueue.then(async () => {
    const handle = await open(logPath, 'a')
    try { await handle.writeFile(text) } finally { await handle.close() }
  })
  return logQueue
}

const exitCode = await new Promise(resolveExit => {
  const child = spawn('node', ['scripts/run-turbo.cjs', 'run', 'test', '--force'], {
    cwd: repoRoot,
    env: { ...process.env, LESSHUB_TEST_RESULTS_DIR: resultRoot },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', chunk => void log(chunk))
  child.stderr.on('data', chunk => void log(chunk))
  child.once('error', error => {
    void log(`\nrunner error: ${error.message}\n`)
    resolveExit(1)
  })
  child.once('exit', code => resolveExit(code ?? 1))
})
await logQueue

const exists = async path => stat(path).then(() => true).catch(() => false)
const packageData = []
for (const { name, relative, testScript } of packageReports) {
  const artifactDirectory = `packages/${relative.split('/').at(-1)}`
  const root = resolve(resultRoot, artifactDirectory)
  const junit = resolve(root, 'junit.xml')
  const coverage = resolve(root, 'coverage', 'coverage-summary.json')
  const hasJunit = await exists(junit)
  const hasCoverage = await exists(coverage)
  const status = !testScript
    ? 'not-applicable'
    : hasJunit
      ? hasCoverage ? 'collected' : 'coverage-missing'
      : 'partial'
  packageData.push({
    name,
    workspace: relative,
    testScript,
    junit: hasJunit ? `${artifactDirectory}/junit.xml` : null,
    coverage: hasCoverage ? `${artifactDirectory}/coverage/coverage-summary.json` : null,
    coverageSummary: hasCoverage ? JSON.parse(await readFile(coverage, 'utf8')) : null,
    status
  })
}

const junitBodies = []
for (const entry of packageData) {
  if (!entry.junit) continue
  const path = resolve(resultRoot, entry.junit)
  const xml = await readFile(path, 'utf8')
  const body = xml.replace(/^\s*<\?xml[^>]*>\s*/i, '').replace(/^\s*<testsuites[^>]*>/i, '').replace(/<\/testsuites>\s*$/i, '')
  junitBodies.push(body)
}
await writeFile(resolve(resultRoot, 'junit.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>${junitBodies.join('')}</testsuites>\n`)
await writeFile(resolve(resultRoot, 'coverage-summary.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  packages: Object.fromEntries(packageData.map(entry => [entry.name, {
    workspace: entry.workspace,
    testScript: entry.testScript,
    status: entry.status,
    summary: entry.coverageSummary,
    artifact: entry.coverage
  }]))
}, null, 2) + '\n')
const reportLines = [
  '# Test report',
  '',
  `Run: ${resultRoot.split('/').at(-1)}`,
  `Exit code: ${exitCode}`,
  '',
  '| Package | Workspace | Test script | Status | JUnit | V8 coverage |',
  '|---|---|---|---|---|---|',
  ...packageData.map(entry => `| ${entry.name} | ${entry.workspace} | ${entry.testScript ? 'yes' : 'no'} | ${entry.status} | ${entry.junit ? 'collected' : '—'} | ${entry.coverage ? `[summary](${entry.coverage})` : '—'} |`),
  '',
  `Turbo test scope: ${packageData.length} workspaces (${packageData.map(entry => entry.workspace).join(', ')}). Only the ${packageData.filter(entry => entry.testScript).length} workspaces with a package.json test script are executed; ${packageData.filter(entry => !entry.testScript).length} are explicitly not-applicable, not missing.`,
  'Statuses are collected, coverage-missing, partial, or not-applicable. A missing JUnit artifact for an executable test scope is partial; no threshold is enforced.',
  '',
  'Artifacts: `test.log`, `junit.xml`, and `coverage-summary.json` in this run directory.'
]
await writeFile(resolve(resultRoot, 'test-report.md'), reportLines.join('\n') + '\n')
console.log(`TEST_RESULTS_DIR=${resultRoot}`)
process.exitCode = exitCode
