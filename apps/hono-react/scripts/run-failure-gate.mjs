import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '../..')
const pagePort = process.env.E2E_PAGE_PORT
const commercePort = process.env.E2E_COMMERCE_PORT
const redisPort = process.env.E2E_REDIS_PORT
const resultRoot = process.env.E2E_RESULTS_DIR
const token = process.env.E2E_INTERNAL_TOKEN
const sessionSecret = process.env.E2E_SESSION_SECRET
const composeProject = process.env.E2E_COMPOSE_PROJECT
const composeFile = resolve(repoRoot, 'compose.rendering-poc.yml')
if (!pagePort || !commercePort || !redisPort || !resultRoot || !token || !sessionSecret || !composeProject)
  throw new Error('failure gate requires the isolated E2E environment')

const pageOrigin = `http://127.0.0.1:${pagePort}`
const commerceOrigin = `http://127.0.0.1:${commercePort}`
const redisUrl = `redis://127.0.0.1:${redisPort}`
const composeArgs = action => [
  ...(process.env.DOCKER_CONTEXT ? ['--context', process.env.DOCKER_CONTEXT] : []),
  'compose', '-p', composeProject, '-f', composeFile, ...action
]

let activeExec
function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = execFile(command, args, { cwd: repoRoot, env: process.env }, error => {
      if (activeExec === child) activeExec = undefined
      error ? reject(error) : resolveRun()
    })
    activeExec = child
  })
}
let activeProcess
function start(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
  activeProcess = child
  child.once('error', () => {})
  return child
}
async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise(resolveStop => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolveStop() }, 3000)
    child.once('exit', () => { clearTimeout(timer); resolveStop() })
  })
  if (activeProcess === child) activeProcess = undefined
}
async function waitHealth(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return } catch { /* bounded startup retry */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`health timeout: ${url}`)
}
async function response(url, init) {
  const value = await fetch(url, init)
  return { status: value.status, cache: value.headers.get('x-cache'), body: await value.text() }
}
async function page(path, init) { return response(`${pageOrigin}${path}`, init) }
async function commerce(path, init) { return response(`${commerceOrigin}${path}`, init) }
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
async function postPage(path, body) {
  const value = await page(path, { method: 'POST', headers: auth, body: body ? JSON.stringify(body) : undefined })
  if (value.status !== 200) throw new Error(`${path} returned ${value.status}`)
  return value
}
async function expectPage(path, status, cache) {
  const value = await page(path)
  if (value.status !== status || (cache !== undefined && value.cache !== cache))
    throw new Error(`${path}: expected ${status}/${cache ?? '*'}, got ${value.status}/${value.cache}`)
  return value
}

let pageProcess
let commerceProcess
let browser
let cancelled = false
let requestedExitCode = 0
let cleanupPromise
const evidence = { redis: {}, commerce: {} }

async function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    activeExec?.kill('SIGTERM')
    await browser?.close().catch(() => {})
    browser = undefined
    // Always attempt an idempotent Redis recovery on every exit path. This
    // covers cancellation while docker or an HTTP assertion is in flight,
    // before or after a successful restart.
    await run('docker', composeArgs(['start', 'redis'])).catch(() => {})
    await stop(pageProcess)
    await stop(commerceProcess)
  })()
  return cleanupPromise
}
function handleSignal(signal) {
  if (cancelled) return
  cancelled = true
  requestedExitCode = signal === 'SIGINT' ? 130 : 143
  // Let the main catch/finally persist partial evidence before the top-level
  // runner decides the process exit code.
  void cleanup()
}
process.once('SIGINT', handleSignal)
process.once('SIGTERM', handleSignal)

try {
  const common = {
    INTERNAL_SERVICE_TOKEN: token,
    PAGE_SERVER_URL: pageOrigin,
    PAGE_SERVICE_URL: pageOrigin,
    PAGE_SERVICE_ALLOWED_ORIGINS: pageOrigin
  }
  commerceProcess = start('node', ['dist/server/server.js'], resolve(repoRoot, 'apps/commerce-api'), {
    ...common, COMMERCE_API_HOST: '127.0.0.1', COMMERCE_API_PORT: commercePort
  })
  await waitHealth(`${commerceOrigin}/health`)
  pageProcess = start('node', ['dist/server/server.js'], appRoot, {
    ...common, PAGE_SERVER_HOST: '127.0.0.1', PAGE_SERVER_PORT: pagePort,
    COMMERCE_API_URL: commerceOrigin, REDIS_URL: redisUrl,
    SESSION_SIGNING_SECRET: sessionSecret, NODE_ENV: 'test', ENABLE_DEMO_ENDPOINTS: 'false'
  })
  await waitHealth(`${pageOrigin}/health`)
  await postPage('/internal/cache/reset')

  await run('docker', composeArgs(['stop', 'redis']))
  evidence.redis.html = (await expectPage('/gb/en-us/benchmark/html-cache/products', 200, 'BYPASS')).cache
  evidence.redis.data = (await expectPage('/gb/en-us/benchmark/data-cache/products', 200, 'BYPASS')).cache
  evidence.redis.live = (await expectPage('/gb/en-us/benchmark/live-ssr/products', 200, 'NONE')).cache
  evidence.redis.csr = (await expectPage('/gb/en-us/benchmark/csr/products', 200, 'NONE')).cache
  await run('docker', composeArgs(['start', 'redis']))
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await postPage('/internal/benchmark/cache/prewarm', { country: 'gb', language: 'en-us', artifactType: 'page-html' }); break } catch { await new Promise(resolveWait => setTimeout(resolveWait, 100)) }
  }
  await postPage('/internal/benchmark/cache/prewarm', { country: 'gb', language: 'en-us', artifactType: 'page-data' })

  const htmlPath = '/gb/en-us/benchmark/html-cache/products'
  const dataPath = '/gb/en-us/benchmark/data-cache/products'
  if ((await expectPage(htmlPath, 200, 'HIT')).cache !== 'HIT' || (await expectPage(dataPath, 200, 'HIT')).cache !== 'HIT') throw new Error('cached outage control was not HIT')
  await stop(commerceProcess)
  evidence.commerce.cachedHtml = (await expectPage(htmlPath, 200, 'HIT')).cache
  evidence.commerce.cachedData = (await expectPage(dataPath, 200, 'HIT')).cache
  await postPage('/internal/benchmark/cache/clear', { country: 'gb', language: 'en-us', artifactType: 'page-html' })
  await postPage('/internal/benchmark/cache/clear', { country: 'gb', language: 'en-us', artifactType: 'page-data' })
  evidence.commerce.html503 = (await expectPage(htmlPath, 503)).status
  evidence.commerce.data503 = (await expectPage(dataPath, 503)).status
  evidence.commerce.live503 = (await expectPage('/gb/en-us/benchmark/live-ssr/products', 503)).status
  evidence.commerce.csrShell = (await expectPage('/gb/en-us/benchmark/csr/products', 200, 'NONE')).status
  evidence.commerce.bff503 = (await response(`${pageOrigin}/api/catalog?country=gb&language=en-us`)).status

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const browserPage = await browser.newPage()
  await browserPage.goto(`${pageOrigin}/gb/en-us/benchmark/csr/products`)
  await browserPage.getByRole('alert').waitFor()
  commerceProcess = start('node', ['dist/server/server.js'], resolve(repoRoot, 'apps/commerce-api'), {
    ...common, COMMERCE_API_HOST: '127.0.0.1', COMMERCE_API_PORT: commercePort
  })
  await waitHealth(`${commerceOrigin}/health`)
  await browserPage.getByRole('button', { name: 'Retry catalog' }).click()
  await browserPage.locator('[data-product-id]').first().waitFor()
  evidence.commerce.browserRetry = 'recovered'
  await browser.close()
  browser = undefined
  await postPage('/internal/cache/reset')
  await commerce('/internal/reset', { method: 'POST', headers: auth })
  await writeFile(resolve(resultRoot, 'failure-gate.json'), JSON.stringify({ passed: true, evidence }, null, 2) + '\n')
} catch (error) {
  await writeFile(resolve(resultRoot, 'failure-gate.json'), JSON.stringify({ passed: false, evidence, error: error instanceof Error ? error.message : String(error) }, null, 2) + '\n')
  throw error
} finally {
  await cleanup()
  if (cancelled) process.exitCode = requestedExitCode
}
