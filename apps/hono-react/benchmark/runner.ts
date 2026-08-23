import { randomBytes } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { connect, createServer, type Socket } from 'node:net'
import { cpus, hostname, platform, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import autocannon from 'autocannon'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  browserSummarySchema,
  environmentSchema,
  serverSummarySchema,
  type BrowserCacheEvidence,
  type BrowserSummary,
  type ServerSummary
} from './schema.js'
import {
  assertBrowserCacheEvidence,
  assertExactBrowserMatrix,
  assertExactRawServerArtifacts,
  assertExactServerMatrix,
  planBrowserMatrix,
  planServerMatrix,
  serverMatrixDescriptorSchema,
  browserMatrixDescriptorSchema,
  serverDescriptorFromResult,
  type BrowserMatrixDescriptor
} from './protocol.js'
import { validateAutocannonResult } from './protocol.js'
import { createCancellationCoordinator } from './cancellation.js'
import { percentiles } from './stats.js'
import { buildWarmAggregates } from './aggregates.js'
import { BENCHMARK_BROWSER_INIT_SCRIPT } from './browser-marks.js'
import { transferBytesForExtension } from './resource-transfer.js'
import { profiles, rotateLeft, rotatedStrategies, type BenchmarkProfile } from './profile.js'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(appRoot, '../..')
const benchmarkRoot = resolve(repoRoot, 'benchmark')
const requestedProfile = (process.argv[2] ?? 'quick') as keyof typeof profiles
const profile = profiles[requestedProfile]
if (!profile) throw new Error('profile must be quick or full')
const validateOnly = process.argv.includes('--validate-only')
const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
const runId = `${stamp}-${randomBytes(4).toString('hex')}`
const resultRoot = resolve(benchmarkRoot, 'results', runId)
const rawServer = resolve(resultRoot, 'raw/server')
const rawServices = resolve(resultRoot, 'raw/services')
const rawBrowser = resolve(resultRoot, 'raw/browser')
const token = randomBytes(32).toString('hex')
const sessionSecret = randomBytes(32).toString('hex')
const composeProject = `lesshub-benchmark-${randomBytes(4).toString('hex')}`
const composeFile = resolve(repoRoot, 'compose.rendering-poc.yml')
const countries = ['us', 'gb', 'jp', 'sg'] as const
const languages = ['en-us', 'ja-jp', 'zh-cn'] as const
const cachedStrategies = ['html-cache', 'data-cache'] as const
const targetCountry = 'gb'
const targetLanguage = 'en-us'

let pagePort = 0
let commercePort = 0
let redisPort = 0
let pageProcess: ChildProcess | undefined
let commerceProcess: ChildProcess | undefined
let browser: Browser | undefined
let benchmarkEnvironment: NodeJS.ProcessEnv = process.env
let dockerContext = process.env.DOCKER_CONTEXT ?? ''
let dockerEngineVersion = 'unknown'
let chromeVersion = 'unknown'
let composeStarted = false
let cleanupPromise: Promise<void> | undefined
let partialPromise: Promise<void> | undefined
const commandChildren = new Set<ChildProcess>()
const serviceStreams = new Map<ChildProcess, WriteStream>()

async function log(message: string) {
  const line = `${new Date().toISOString()} ${message}`
  console.log(line)
  if (!validateOnly) await appendFile(resolve(resultRoot, 'run.log'), `${line}\n`)
}

async function allocatePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('port allocation failed'))
        return
      }
      const value = address.port
      server.close(error => (error ? reject(error) : resolvePort(value)))
    })
  })
}

async function command(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = repoRoot
): Promise<void> {
  await new Promise<void>((resolveCommand, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: 'inherit' })
    commandChildren.add(child)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      commandChildren.delete(child)
      if (code === 0) resolveCommand()
      else reject(new Error(`${executable} failed: ${code ?? signal ?? 'unknown'}`))
    })
  })
}

async function capture(executable: string, args: string[]): Promise<string> {
  return await new Promise((resolveCapture, reject) => {
    const child = spawn(executable, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
    commandChildren.add(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.once('error', reject)
    child.once('exit', code => {
      commandChildren.delete(child)
      if (code === 0) resolveCapture(stdout.trim())
      else reject(new Error(`${executable} ${args.join(' ')} failed: ${stderr.trim()}`))
    })
  })
}

function dockerArgs(action: string[]) {
  return [
    ...(dockerContext ? ['--context', dockerContext] : []),
    'compose',
    '-p',
    composeProject,
    '-f',
    composeFile,
    ...action
  ]
}

async function docker(action: string[], env: NodeJS.ProcessEnv) {
  await command('docker', dockerArgs(action), env)
}

async function health(url: string, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Retry until the bounded deadline.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`health timeout: ${url}`)
}

function startService(name: 'page' | 'commerce', cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn('node', ['dist/server/server.js'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const output = createWriteStream(resolve(rawServices, `${name}.ndjson`), { flags: 'a' })
  child.stdout.pipe(output, { end: false })
  child.stderr.pipe(output, { end: false })
  serviceStreams.set(child, output)
  return child
}

async function startCommerce(env: NodeJS.ProcessEnv) {
  commerceProcess = startService('commerce', resolve(repoRoot, 'apps/commerce-api'), env)
  await health(`http://127.0.0.1:${commercePort}/health`)
}

async function startPage(env: NodeJS.ProcessEnv) {
  pageProcess = startService('page', appRoot, env)
  await health(`http://127.0.0.1:${pagePort}/health`)
}

async function stopProcess(child: ChildProcess | undefined) {
  if (!child) return
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise<void>(resolveStop => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolveStop()
      }, 3_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolveStop()
      })
    })
  }
  const stream = serviceStreams.get(child)
  if (stream) {
    await new Promise<void>(resolveClose => stream.end(resolveClose))
    serviceStreams.delete(child)
  }
}

function auth() {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

async function json(url: string, init?: RequestInit): Promise<Record<string, any>> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new Error(`${new URL(url).pathname} -> ${response.status}: ${JSON.stringify(body)}`)
  return body as Record<string, any>
}

const pageUrl = (path = '') => `http://127.0.0.1:${pagePort}${path}`
const commerceUrl = (path = '') => `http://127.0.0.1:${commercePort}${path}`
const pageRoute = (strategy: string, country = targetCountry, language = targetLanguage) =>
  `/${country}/${language}/benchmark/${strategy}/products`
const artifactFor = (strategy: 'html-cache' | 'data-cache') =>
  strategy === 'html-cache' ? 'page-html' : 'page-data'

async function clearTarget(
  strategy: 'html-cache' | 'data-cache',
  country = targetCountry,
  language = targetLanguage
) {
  const body = await json(pageUrl('/internal/benchmark/cache/clear'), {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ country, language, artifactType: artifactFor(strategy) })
  })
  if (body.deleted !== true) throw new Error(`Cache clear did not confirm deleted=true`)
}

async function prewarmTarget(
  strategy: 'html-cache' | 'data-cache',
  country = targetCountry,
  language = targetLanguage
) {
  const body = await json(pageUrl('/internal/benchmark/cache/prewarm'), {
    method: 'POST',
    headers: auth(),
    body: JSON.stringify({ country, language, artifactType: artifactFor(strategy) })
  })
  if (body.warmed !== true || body.cacheStatus !== 'HIT')
    throw new Error(`Prewarm did not confirm HIT for ${country}/${language}/${strategy}`)
}

async function resetMetrics() {
  await json(pageUrl('/internal/benchmark/metrics/reset'), { method: 'POST', headers: auth() })
}

async function metrics() {
  return await json(pageUrl('/internal/benchmark/metrics/snapshot'), { headers: auth() })
}

interface PageObservation {
  status: number
  cache: string | null
  text: string
  bytes: number
  latencyMs: number
}

async function pageRequest(
  strategy: string,
  country = targetCountry,
  language = targetLanguage
): Promise<PageObservation> {
  const started = performance.now()
  const response = await fetch(pageUrl(pageRoute(strategy, country, language)), {
    headers: { 'x-benchmark-run': runId }
  })
  const text = await response.text()
  return {
    status: response.status,
    cache: response.headers.get('x-cache'),
    text,
    bytes: Buffer.byteLength(text),
    latencyMs: performance.now() - started
  }
}

async function burstPageRequests(strategy: string, count: number) {
  const sockets = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<Socket>((resolveSocket, reject) => {
          const socket = connect({ host: '127.0.0.1', port: pagePort })
          socket.once('connect', () => resolveSocket(socket))
          socket.once('error', reject)
        })
    )
  )
  const starts = new Map<Socket, number>()
  const responses = sockets.map(
    socket =>
      new Promise<{ status: number; cache: string | null; latencyMs: number }>((resolveResponse, reject) => {
        let raw = ''
        socket.setEncoding('utf8')
        socket.on('data', chunk => (raw += chunk))
        socket.once('error', reject)
        socket.once('close', () => {
          resolveResponse({
            status: Number(/^HTTP\/1\.1 (\d+)/.exec(raw)?.[1] ?? 0),
            cache: /^x-cache:\s*([^\r\n]+)/im.exec(raw)?.[1]?.trim() ?? null,
            latencyMs: performance.now() - (starts.get(socket) ?? performance.now())
          })
        })
      })
  )
  const request = `GET ${pageRoute(strategy)} HTTP/1.1\r\nHost: 127.0.0.1:${pagePort}\r\nConnection: close\r\nX-Benchmark-Run: ${runId}\r\n\r\n`
  const batchStarted = performance.now()
  for (const socket of sockets) {
    starts.set(socket, performance.now())
    socket.write(request)
  }
  const values = await Promise.all(responses)
  return { responses: values, makespanMs: performance.now() - batchStarted }
}

interface CannonResult {
  raw: any
  observedLatency: ReturnType<typeof percentiles>
}

async function cannon(url: string, connections: number, duration: number): Promise<CannonResult> {
  return await new Promise((resolveCannon, reject) => {
    const observed: number[] = []
    const instance: any = autocannon({
      url,
      connections,
      duration,
      headers: { 'x-benchmark-run': runId }
    })
    instance.on('response', (_client: unknown, _status: number, _bytes: number, responseTime: number) => {
      if (Number.isFinite(responseTime)) observed.push(responseTime)
    })
    instance.once('error', reject)
    instance.once('done', (raw: any) => {
      if (observed.length !== raw.requests.total)
        return reject(
          new Error(`Autocannon latency samples ${observed.length} != requests ${raw.requests.total}`)
        )
      resolveCannon({ raw, observedLatency: percentiles(observed) })
    })
  })
}

function serverResult(input: {
  id: string
  segment: string
  scenario: 'warm' | 'cold' | 'cold-burst' | 'combined'
  strategy: ServerSummary['results'][number]['strategy']
  cacheCondition: 'warm' | 'cold' | 'N/A'
  round: number
  count: number
  latency: ReturnType<typeof percentiles>
  requestsPerSecond: number | null
  errors?: number
  timeouts?: number
  comparable?: boolean
  transactionCost?: {
    requestsPerTransaction: 2
    totalRequests: number
    responseBytes: ReturnType<typeof percentiles>
  }
}) {
  return {
    id: input.id,
    segment: input.segment,
    scenario: input.scenario,
    strategy: input.strategy,
    cacheCondition: input.cacheCondition,
    comparable: input.comparable ?? (input.strategy !== 'csr-shell' && input.strategy !== 'csr-catalog-bff' && input.strategy !== 'csr-combined'),
    round: input.round,
    count: input.count,
    errors: input.errors ?? 0,
    timeouts: input.timeouts ?? 0,
    latencyMs: input.latency,
    requestsPerSecond: input.requestsPerSecond,
    ...(input.transactionCost ? { transactionCost: input.transactionCost } : {}),
    units: { latency: 'ms' as const, throughput: 'requests/second' as const }
  }
}

async function writeParsed(path: string, schema: { parse(value: unknown): any }, value: unknown) {
  const parsed = schema.parse(value)
  await writeFile(path, JSON.stringify(parsed, null, 2))
  schema.parse(JSON.parse(await readFile(path, 'utf8')))
}

async function prewarmMatrix(
  selectedCountries: readonly (typeof countries)[number][],
  selectedLanguages: readonly (typeof languages)[number][]
) {
  for (const country of selectedCountries)
    for (const language of selectedLanguages)
      for (const strategy of cachedStrategies)
        await prewarmTarget(strategy, country, language)
}

function assertVersionAndText(page: PageObservation, version: number, expectedText?: string) {
  if (page.status !== 200) throw new Error(`Expected page 200, received ${page.status}`)
  if (!page.text.includes(`data-version="${version}"`))
    throw new Error(`Page did not expose data-version=${version}`)
  if (expectedText && !page.text.includes(expectedText))
    throw new Error(`Page did not include expected value ${expectedText}`)
}

async function assertMissMatrix(
  selectedCountries: readonly (typeof countries)[number][],
  selectedLanguages: readonly (typeof languages)[number][],
  version?: number,
  expectedText?: string
) {
  let observedTargetKeys = 0
  for (const country of selectedCountries)
    for (const language of selectedLanguages)
      for (const strategy of cachedStrategies) {
        const response = await pageRequest(strategy, country, language)
        if (response.cache !== 'MISS')
          throw new Error(`${country}/${language}/${strategy} expected MISS, received ${response.cache}`)
        if (version !== undefined) assertVersionAndText(response, version, expectedText)
        observedTargetKeys += 1
      }
  return observedTargetKeys
}

async function assertInvalidationPartition(
  affected: (country: (typeof countries)[number], language: (typeof languages)[number]) => boolean,
  version: number,
  expectedText: string
) {
  let affectedMisses = 0
  let unaffectedHits = 0
  for (const country of countries)
    for (const language of languages)
      for (const strategy of cachedStrategies) {
        const response = await pageRequest(strategy, country, language)
        if (affected(country, language)) {
          if (response.cache !== 'MISS')
            throw new Error(`${country}/${language}/${strategy} expected affected MISS, received ${response.cache}`)
          assertVersionAndText(response, version, expectedText)
          affectedMisses += 1
        } else {
          if (response.cache !== 'HIT')
            throw new Error(`${country}/${language}/${strategy} expected complement HIT, received ${response.cache}`)
          unaffectedHits += 1
        }
      }
  return { affectedMisses, unaffectedHits }
}

async function catalog(country = targetCountry, language = targetLanguage) {
  return await json(pageUrl(`/api/catalog?country=${country}&language=${language}`))
}

function productOne(value: Record<string, any>) {
  const product = value.products?.find((item: Record<string, any>) => item.id === 'product-01')
  if (!product) throw new Error('product-01 missing from catalog')
  return product as Record<string, any>
}

async function assertLiveAndBff(
  version: number,
  predicate: (product: Record<string, any>) => boolean,
  expectedHtml: string
) {
  const live = await pageRequest('live-ssr')
  if (live.cache !== 'NONE') throw new Error(`live-ssr expected NONE, received ${live.cache}`)
  assertVersionAndText(live, version, expectedHtml)
  const bff = await catalog()
  if (bff.dataVersion !== version || !predicate(productOne(bff)))
    throw new Error('CSR BFF did not expose the latest catalog value/version')
}

async function mutationAndInvalidationChecks(correctness: ServerSummary['correctness']) {
  await json(commerceUrl('/internal/reset'), { method: 'POST', headers: auth() })

  await prewarmMatrix(countries, languages)
  const price = await json(commerceUrl('/internal/products/product-01/price'), {
    method: 'PATCH', headers: auth(), body: JSON.stringify({ countryCode: 'GB', priceMinor: 999 })
  })
  const pricePartition = await assertInvalidationPartition(
    country => country === 'gb',
    price.dataVersion,
    '£9.99'
  )
  if (pricePartition.affectedMisses !== 6 || pricePartition.unaffectedHits !== 18)
    throw new Error(`Price invalidation partition mismatch: ${JSON.stringify(pricePartition)}`)
  await assertLiveAndBff(price.dataVersion, product => product.priceMinor === 999, '£9.99')
  correctness.push({
    scenario: 'mutation-price',
    passed: true,
    evidence: {
      observedAffectedMisses: pricePartition.affectedMisses,
      observedUnaffectedHits: pricePartition.unaffectedHits,
      priceMinor: 999,
      formattedPrice: '£9.99',
      dataVersion: price.dataVersion
    }
  })

  await prewarmMatrix(countries, languages)
  const translatedName = 'Benchmark Translation'
  const translation = await json(commerceUrl('/internal/products/product-01/translations/ja-JP'), {
    method: 'PATCH', headers: auth(), body: JSON.stringify({ name: translatedName, description: 'Observed benchmark translation.' })
  })
  const translationPartition = await assertInvalidationPartition(
    (_country, language) => language === 'ja-jp',
    translation.dataVersion,
    translatedName
  )
  if (translationPartition.affectedMisses !== 8 || translationPartition.unaffectedHits !== 16)
    throw new Error(`Translation invalidation partition mismatch: ${JSON.stringify(translationPartition)}`)
  const liveJa = await pageRequest('live-ssr', 'gb', 'ja-jp')
  assertVersionAndText(liveJa, translation.dataVersion, translatedName)
  const bffJa = await catalog('gb', 'ja-jp')
  if (bffJa.dataVersion !== translation.dataVersion || productOne(bffJa).name !== translatedName)
    throw new Error('Translation was not visible in CSR BFF')
  correctness.push({
    scenario: 'mutation-translation',
    passed: true,
    evidence: {
      observedAffectedMisses: translationPartition.affectedMisses,
      observedUnaffectedHits: translationPartition.unaffectedHits,
      name: translatedName,
      dataVersion: translation.dataVersion
    }
  })

  await prewarmMatrix(countries, languages)
  const inventory = await json(commerceUrl('/internal/products/product-01/inventory'), {
    method: 'PATCH', headers: auth(), body: JSON.stringify({ inventory: 0 })
  })
  const inventoryKeys = await assertMissMatrix(countries, languages, inventory.dataVersion)
  await assertLiveAndBff(inventory.dataVersion, product => product.inventory === 0, 'Out of stock')
  correctness.push({ scenario: 'mutation-inventory', passed: true, evidence: { observedTargetKeys: inventoryKeys, inventory: 0, dataVersion: inventory.dataVersion } })

  await prewarmMatrix(countries, languages)
  await json(pageUrl('/internal/cache/invalidate'), {
    method: 'POST', headers: auth(), body: JSON.stringify({ type: 'product', scope: 'all' })
  })
  const productKeys = await assertMissMatrix(countries, languages)
  correctness.push({ scenario: 'mutation-product', passed: true, evidence: { observedTargetKeys: productKeys } })

  await prewarmMatrix(countries, languages)
  const reset = await json(commerceUrl('/internal/reset'), { method: 'POST', headers: auth() })
  const resetKeys = await assertMissMatrix(countries, languages, reset.dataVersion)
  await assertLiveAndBff(reset.dataVersion, product => product.inventory === 18 && product.name === 'Field Notebook', 'Field Notebook')
  correctness.push({ scenario: 'mutation-reset', passed: true, evidence: { observedTargetKeys: resetKeys, inventory: 18, dataVersion: reset.dataVersion } })
}

async function prewarmEventually(strategy: 'html-cache' | 'data-cache') {
  let failure: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await prewarmTarget(strategy)
      return
    } catch (error) {
      failure = error
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
    }
  }
  throw failure
}

async function failureChecks(correctness: ServerSummary['correctness']) {
  await prewarmTarget('html-cache')
  await prewarmTarget('data-cache')
  await docker(['stop', 'redis'], benchmarkEnvironment)
  for (const strategy of ['html-cache', 'data-cache', 'live-ssr', 'csr']) {
    const response = await pageRequest(strategy)
    if (response.status !== 200) throw new Error(`Redis failure ${strategy} returned ${response.status}`)
    if (cachedStrategies.includes(strategy as any) && response.cache !== 'BYPASS')
      throw new Error(`${strategy} did not BYPASS while Redis was unavailable`)
  }
  correctness.push({ scenario: 'redis-failure', passed: true, evidence: { html: 'BYPASS', data: 'BYPASS', live: 'control', csr: 'control' } })
  await docker(['start', 'redis'], benchmarkEnvironment)
  await prewarmEventually('html-cache')
  await prewarmEventually('data-cache')

  await prewarmTarget('html-cache')
  await prewarmTarget('data-cache')
  await stopProcess(commerceProcess)
  commerceProcess = undefined
  if ((await pageRequest('html-cache')).cache !== 'HIT' || (await pageRequest('data-cache')).cache !== 'HIT')
    throw new Error('Cached pages were unavailable during commerce outage')
  await clearTarget('html-cache')
  await clearTarget('data-cache')
  for (const strategy of ['html-cache', 'data-cache', 'live-ssr'])
    if ((await pageRequest(strategy)).status !== 503)
      throw new Error(`${strategy} did not return 503 during commerce outage`)
  if ((await pageRequest('csr')).status !== 200) throw new Error('CSR shell failed during commerce outage')
  if ((await fetch(pageUrl('/api/catalog?country=gb&language=en-us'))).status !== 503)
    throw new Error('CSR BFF did not return 503 during commerce outage')
  const recoveryBrowser = await chromium.launch({ channel: 'chrome', headless: true })
  browser = recoveryBrowser
  const recoveryPage = await recoveryBrowser.newPage()
  await recoveryPage.goto(pageUrl(pageRoute('csr')))
  await recoveryPage.getByRole('alert').waitFor()
  await startCommerce(benchmarkEnvironment)
  await json(commerceUrl('/internal/reset'), { method: 'POST', headers: auth() })
  await recoveryPage.getByRole('button', { name: 'Retry catalog' }).click()
  await recoveryPage.locator('[data-product-id]').first().waitFor()
  await recoveryBrowser.close()
  browser = undefined
  correctness.push({ scenario: 'commerce-failure', passed: true, evidence: { cached: 'HIT', uncached: 503, csrShell: 200, csrBff: 503, browserRetry: 'recovered' } })
  await prewarmTarget('html-cache')
  await prewarmTarget('data-cache')
}

async function runServer(selectedProfile: BenchmarkProfile): Promise<ServerSummary> {
  const results: ServerSummary['results'] = []
  const warmAggregates: ServerSummary['warmAggregates'] = []
  const correctness: ServerSummary['correctness'] = []

  for (let round = 0; round < selectedProfile.rounds; round += 1) {
    cancellation.throwIfCancelled()
    await json(commerceUrl('/internal/reset'), { method: 'POST', headers: auth() })
    await log(`server round ${round + 1}/${selectedProfile.rounds}`)
    for (const strategy of rotatedStrategies(round)) {
      cancellation.throwIfCancelled()
      const endpoints = strategy === 'csr'
        ? [
            { strategy: 'csr-shell' as const, url: pageUrl(pageRoute('csr')) },
            { strategy: 'csr-catalog-bff' as const, url: pageUrl('/api/catalog?country=gb&language=en-us') }
          ]
        : [{ strategy, url: pageUrl(pageRoute(strategy)) }]
      for (const endpoint of endpoints) {
        for (let segment = 0; segment < selectedProfile.warmSegments; segment += 1) {
          if (strategy === 'html-cache' || strategy === 'data-cache') await prewarmTarget(strategy)
          await resetMetrics()
          const measured = await cannon(endpoint.url, selectedProfile.connections, selectedProfile.segmentSeconds)
          const raw = measured.raw
          validateAutocannonResult({
            non2xx: raw.non2xx,
            errors: raw.errors,
            timeouts: raw.timeouts,
            mismatches: raw.mismatches,
            resets: raw.resets
          })
          const snapshot = await metrics()
          await writeFile(
            resolve(rawServer, `warm-r${round}-${endpoint.strategy}-s${segment}.json`),
            JSON.stringify({
              load: {
                requests: raw.requests,
                throughput: raw.throughput,
                latencyMs: measured.observedLatency,
                non2xx: raw.non2xx,
                errors: raw.errors,
                timeouts: raw.timeouts,
                mismatches: raw.mismatches,
                resets: raw.resets
              },
              metrics: snapshot
            }, null, 2)
          )
          results.push(serverResult({
            id: `warm-r${round}-${endpoint.strategy}-s${segment}`,
            segment: `warm-${segment}`,
            scenario: 'warm',
            strategy: endpoint.strategy,
            cacheCondition: strategy === 'html-cache' || strategy === 'data-cache' ? 'warm' : 'N/A',
            round,
            count: raw.requests.total,
            latency: measured.observedLatency,
            requestsPerSecond: raw.requests.average,
            errors: raw.errors,
            timeouts: raw.timeouts
          }))
        }
      }

      const resultStrategy = strategy === 'csr' ? 'csr-shell' : strategy
      const serialSamples: Array<{
        sample: number
        status: number
        cache: string | null
        bytes: number
        latencyMs: number
      }> = []
      for (let sample = 0; sample < selectedProfile.coldSerialPerRound; sample += 1) {
        if (strategy === 'html-cache' || strategy === 'data-cache') await clearTarget(strategy)
        const response = await pageRequest(strategy)
        if (response.status !== 200) throw new Error(`Cold ${strategy} returned ${response.status}`)
        const expectedCache = strategy === 'html-cache' || strategy === 'data-cache' ? 'MISS' : 'NONE'
        if (response.cache !== expectedCache)
          throw new Error(`Cold ${strategy} expected ${expectedCache}, received ${response.cache}`)
        serialSamples.push({
          sample,
          status: response.status,
          cache: response.cache,
          bytes: response.bytes,
          latencyMs: response.latencyMs
        })
      }
      const serialLatencies = serialSamples.map(sample => sample.latencyMs)
      await writeFile(
        resolve(rawServer, `cold-r${round}-${resultStrategy}-serial.json`),
        JSON.stringify({ latencyMs: percentiles(serialLatencies), samples: serialSamples }, null, 2)
      )
      results.push(serverResult({
        id: `cold-r${round}-${resultStrategy}-serial`,
        segment: 'serial',
        scenario: 'cold',
        strategy: resultStrategy,
        cacheCondition: strategy === 'html-cache' || strategy === 'data-cache' ? 'cold' : 'N/A',
        round,
        count: serialLatencies.length,
        latency: percentiles(serialLatencies),
        requestsPerSecond: null
      }))

      for (let burst = 0; burst < selectedProfile.coldBurstsPerRound; burst += 1) {
        if (strategy === 'html-cache' || strategy === 'data-cache') await clearTarget(strategy)
        await resetMetrics()
        const batch = await burstPageRequests(strategy, selectedProfile.connections)
        if (batch.responses.some(response => response.status !== 200))
          throw new Error(`Cold burst ${strategy} had a non-200 response`)
        const expectedCache = strategy === 'html-cache' || strategy === 'data-cache' ? 'MISS' : 'NONE'
        if (batch.responses.some(response => response.cache !== expectedCache))
          throw new Error(`Cold burst ${strategy} expected every X-Cache=${expectedCache}`)
        const snapshot = await metrics()
        if (strategy === 'html-cache' || strategy === 'data-cache') {
          const counts = snapshot.counts as Record<string, number>
          if (counts.apiCalls !== 1) throw new Error(`${strategy} burst apiCalls=${counts.apiCalls}`)
          if (strategy === 'html-cache' && (counts.ssrCalls !== 1 || counts['coalescing.waiter'] !== selectedProfile.connections - 1))
            throw new Error('HTML cache burst coalescing invariant failed')
          if (strategy === 'data-cache' && counts.ssrCalls !== selectedProfile.connections)
            throw new Error('Data cache burst SSR invariant failed')
          if (burst === 0)
            correctness.push({
              scenario: `${strategy}-cold-burst-coalescing-r${round}`,
              passed: true,
              evidence: {
                concurrency: selectedProfile.connections,
                apiCalls: counts.apiCalls,
                ssrCalls: counts.ssrCalls,
                leaders: counts['coalescing.leader'],
                waiters: counts['coalescing.waiter']
              }
            })
        }
        const latency = percentiles(batch.responses.map(response => response.latencyMs))
        await writeFile(resolve(rawServer, `cold-r${round}-${resultStrategy}-burst${burst}.json`), JSON.stringify({ makespanMs: batch.makespanMs, latencyMs: latency, responses: batch.responses, metrics: snapshot }, null, 2))
        results.push(serverResult({
          id: `cold-r${round}-${resultStrategy}-burst${burst}`,
          segment: `burst-${burst}`,
          scenario: 'cold-burst',
          strategy: resultStrategy,
          cacheCondition: strategy === 'html-cache' || strategy === 'data-cache' ? 'cold' : 'N/A',
          round,
          count: batch.responses.length,
          latency,
          requestsPerSecond: null
        }))
      }
    }

    const combinedSamples: Array<{
      sample: number
      shell: { status: number; cache: string | null; bytes: number; latencyMs: number }
      bff: { status: number; bytes: number; latencyMs: number }
      transaction: { requests: 2; bytes: number; latencyMs: number }
    }> = []
    for (let sample = 0; sample < selectedProfile.combinedSamplesPerRound; sample += 1) {
      const transactionStarted = performance.now()
      const shell = await pageRequest('csr')
      const bffStarted = performance.now()
      const bffResponse = await fetch(pageUrl('/api/catalog?country=gb&language=en-us'))
      const bffBody = await bffResponse.arrayBuffer()
      const bffLatencyMs = performance.now() - bffStarted
      if (shell.status !== 200 || shell.cache !== 'NONE' || !bffResponse.ok)
        throw new Error('CSR combined transaction failed')
      combinedSamples.push({
        sample,
        shell: {
          status: shell.status,
          cache: shell.cache,
          bytes: shell.bytes,
          latencyMs: shell.latencyMs
        },
        bff: {
          status: bffResponse.status,
          bytes: bffBody.byteLength,
          latencyMs: bffLatencyMs
        },
        transaction: {
          requests: 2,
          bytes: shell.bytes + bffBody.byteLength,
          latencyMs: performance.now() - transactionStarted
        }
      })
    }
    const combinedLatency = percentiles(combinedSamples.map(sample => sample.transaction.latencyMs))
    const combinedBytes = percentiles(combinedSamples.map(sample => sample.transaction.bytes))
    await writeFile(
      resolve(rawServer, `combined-r${round}-csr.json`),
      JSON.stringify({
        requestsPerTransaction: 2,
        totalRequests: combinedSamples.length * 2,
        transactionLatencyMs: combinedLatency,
        transactionResponseBytes: combinedBytes,
        samples: combinedSamples
      }, null, 2)
    )
    results.push(serverResult({
      id: `combined-r${round}-csr`,
      segment: 'combined',
      scenario: 'combined',
      strategy: 'csr-combined',
      cacheCondition: 'N/A',
      round,
      count: combinedSamples.length,
      latency: combinedLatency,
      requestsPerSecond: null,
      comparable: false,
      transactionCost: {
        requestsPerTransaction: 2,
        totalRequests: combinedSamples.length * 2,
        responseBytes: combinedBytes
      }
    }))
  }

  await mutationAndInvalidationChecks(correctness)
  await failureChecks(correctness)

  warmAggregates.push(...buildWarmAggregates(selectedProfile, results))

  assertExactServerMatrix(selectedProfile, results.map(serverDescriptorFromResult))
  assertExactRawServerArtifacts(selectedProfile, results, await readdir(rawServer))
  return serverSummarySchema.parse({
    schemaVersion: 1,
    profile: selectedProfile.name,
    complete: true,
    results,
    warmAggregates,
    correctness
  })
}

interface BrowserSample {
  status: number
  navigationCache: string | null
  ttfb: number
  fcp: number
  lcp: number
  visible: number
  menu: number
  catalog: number | null
  hydration: string[]
  js: number
  css: number
  cacheEvidence: Omit<BrowserCacheEvidence, 'measuredSamples'>
}

function requiredAssets(strategy: string) {
  return strategy === 'csr'
    ? ['user-menu-', 'product-list-', 'client-', 'global-']
    : ['user-menu-', 'client-', 'global-']
}

async function installProductVisibleObserver(page: Page) {
  await page.addInitScript({ content: BENCHMARK_BROWSER_INIT_SCRIPT })
}

async function sampleBrowser(
  context: BrowserContext,
  strategy: string,
  disableCache: boolean
): Promise<BrowserSample> {
  const page = await context.newPage()
  await installProductVisibleObserver(page)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: disableCache })
  const requests = new Map<string, string>()
  const cached = new Set<string>()
  const transferred = new Set<string>()
  const immutable = new Set<string>()
  cdp.on('Network.requestWillBeSent', event => requests.set(event.requestId, event.request.url))
  cdp.on('Network.requestServedFromCache', event => {
    const url = requests.get(event.requestId)
    if (url) cached.add(url)
  })
  cdp.on('Network.responseReceived', event => {
    const url = event.response.url
    if (event.response.fromDiskCache || event.response.fromServiceWorker) cached.add(url)
    else transferred.add(url)
    const cacheControl = String(event.response.headers['cache-control'] ?? event.response.headers['Cache-Control'] ?? '')
    if (cacheControl.includes('max-age=31536000') && cacheControl.includes('immutable')) immutable.add(url)
  })
  const response = await page.goto(pageUrl(pageRoute(strategy)), { waitUntil: 'load' })
  await page.locator('[data-product-id]').first().waitFor({ state: 'visible' })
  await page.waitForFunction(() => performance.getEntriesByName('lesshub:products-visible').length > 0)
  await page.waitForFunction(() => document.querySelector('[data-island="user-menu"] .user-menu')?.getAttribute('data-state') !== 'loading')
  await page.waitForTimeout(100)
  const measured = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    const visible = performance.getEntriesByName('lesshub:products-visible')[0]
    const menu = performance.getEntriesByName('lesshub:user-menu-ready')[0]
    const catalog = performance.getEntriesByName('lesshub:catalog')[0] as PerformanceMeasure | undefined
    return {
      ttfb: navigation.responseStart,
      fcp: fcp?.startTime ?? 0,
      lcp: (window as any).__lesshubLcp ?? 0,
      visible: visible?.startTime ?? 0,
      visibleCount: performance.getEntriesByName('lesshub:products-visible').length,
      menu: menu?.startTime ?? 0,
      catalog: catalog?.duration ?? null,
      hydration: (window as any).__lesshubHydrationErrors ?? [],
      resources: performance.getEntriesByType('resource').map((entry: any) => ({
        name: entry.name,
        type: entry.initiatorType,
        bytes: entry.transferSize ?? 0
      }))
    }
  })
  if (measured.visibleCount !== 1)
    throw new Error(`Expected exactly one products-visible mark, received ${measured.visibleCount}`)
  const required = requiredAssets(strategy)
  const relevantUrls = [...new Set([...requests.values()].filter(url => required.some(name => url.includes(`/assets/${name}`))))]
  if (relevantUrls.length !== required.length)
    throw new Error(`${strategy} requested ${relevantUrls.length}/${required.length} required hashed assets`)
  if (relevantUrls.some(url => !immutable.has(url)))
    throw new Error(`${strategy} asset response was missing immutable cache headers`)
  const sample: BrowserSample = {
    status: response?.status() ?? 0,
    navigationCache: response?.headers()['x-cache'] ?? null,
    ttfb: measured.ttfb,
    fcp: measured.fcp,
    lcp: measured.lcp,
    visible: measured.visible,
    menu: measured.menu,
    catalog: measured.catalog,
    hydration: measured.hydration,
    js: transferBytesForExtension(measured.resources, 'js'),
    css: transferBytesForExtension(measured.resources, 'css'),
    cacheEvidence: {
      assetRequests: relevantUrls.length,
      cacheHits: relevantUrls.filter(url => cached.has(url)).length,
      networkTransfers: relevantUrls.filter(url => transferred.has(url) && !cached.has(url)).length
    }
  }
  await page.close()
  return sample
}

function browserConditionKey(condition: BrowserMatrixDescriptor): string {
  return `${condition.strategy}:${condition.browserCache}:${condition.serverCache}`
}

async function runBrowser(selectedProfile: BenchmarkProfile): Promise<BrowserSummary> {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const conditions = planBrowserMatrix()
  const samplesByCondition = new Map<string, BrowserSample[]>()
  const warmContexts = new Map<string, BrowserContext>()

  for (const condition of conditions) {
    samplesByCondition.set(browserConditionKey(condition), [])
    if (condition.browserCache === 'warm') {
      const context = await browser.newContext()
      warmContexts.set(browserConditionKey(condition), context)
      await sampleBrowser(context, condition.strategy, false)
    }
  }

  for (let sampleIndex = 0; sampleIndex < selectedProfile.browserSamples; sampleIndex += 1) {
    cancellation.throwIfCancelled()
    const sequence = rotateLeft(conditions, sampleIndex)
    await log(`browser sample ${sampleIndex + 1}/${selectedProfile.browserSamples} order=${sequence.map(browserConditionKey).join(',')}`)
    for (let order = 0; order < sequence.length; order += 1) {
      cancellation.throwIfCancelled()
      const condition = sequence[order]!
      if (condition.serverCache === 'cold')
        await clearTarget(condition.strategy as 'html-cache' | 'data-cache')
      else if (condition.serverCache === 'warm')
        await prewarmTarget(condition.strategy as 'html-cache' | 'data-cache')
      const key = browserConditionKey(condition)
      const warmContext = warmContexts.get(key)
      const context = warmContext ?? (await browser.newContext())
      const sample = await sampleBrowser(context, condition.strategy, condition.browserCache === 'cold')
      if (!warmContext) await context.close()
      const expectedCache = condition.serverCache === 'N/A' ? 'NONE' : condition.serverCache === 'cold' ? 'MISS' : 'HIT'
      if (sample.status !== 200 || sample.navigationCache !== expectedCache)
        throw new Error(`${JSON.stringify(condition)} expected navigation ${expectedCache}, received ${sample.navigationCache}/${sample.status}`)
      if (sample.hydration.length) throw new Error(`Hydration errors: ${sample.hydration.join('; ')}`)
      if (condition.strategy === 'csr' ? sample.catalog === null : sample.catalog !== null)
        throw new Error(`${condition.strategy} catalog timing mark invariant failed`)
      if (sample.visible <= 0) throw new Error('products-visible observer mark missing')
      samplesByCondition.get(key)!.push(sample)
      await appendFile(
        resolve(rawBrowser, 'samples.ndjson'),
        `${JSON.stringify({ ...condition, sequenceIndex: sampleIndex, order, sample })}\n`
      )
    }
  }

  await Promise.all([...warmContexts.values()].map(context => context.close()))
  const results: BrowserSummary['results'] = conditions.map(condition => {
    const samples = samplesByCondition.get(browserConditionKey(condition))!
    const evidence: BrowserCacheEvidence = {
      measuredSamples: samples.length,
      assetRequests: samples.reduce((sum, sample) => sum + sample.cacheEvidence.assetRequests, 0),
      cacheHits: samples.reduce((sum, sample) => sum + sample.cacheEvidence.cacheHits, 0),
      networkTransfers: samples.reduce((sum, sample) => sum + sample.cacheEvidence.networkTransfers, 0)
    }
    assertBrowserCacheEvidence(condition.browserCache, evidence, requiredAssets(condition.strategy).length)
    const metric = (key: 'ttfb' | 'fcp' | 'lcp' | 'visible' | 'menu' | 'js' | 'css') =>
      percentiles(samples.map(sample => sample[key]))
    return {
      strategy: condition.strategy,
      browserCache: condition.browserCache,
      serverCache: condition.serverCache,
      samples: samples.length,
      hydrationErrors: 0 as const,
      ttfbMs: metric('ttfb'),
      fcpMs: metric('fcp'),
      lcpMs: metric('lcp'),
      productVisibleMs: metric('visible'),
      userMenuReadyMs: metric('menu'),
      catalogMs: condition.strategy === 'csr' ? percentiles(samples.map(sample => sample.catalog!)) : null,
      jsTransferBytes: metric('js'),
      cssTransferBytes: metric('css'),
      cacheEvidence: evidence
    }
  })
  assertExactBrowserMatrix(results.map(result => ({
    strategy: result.strategy,
    browserCache: result.browserCache,
    serverCache: result.serverCache
  })))
  return browserSummarySchema.parse({
    schemaVersion: 1,
    profile: selectedProfile.name,
    complete: true,
    results
  })
}

async function environment() {
  const pkg = JSON.parse(await readFile(resolve(appRoot, 'package.json'), 'utf8'))
  const git = await capture('git', ['rev-parse', 'HEAD']).catch(() => 'unknown')
  const dirty = Boolean(await capture('git', ['status', '--porcelain']).catch(() => 'unknown'))
  return {
    schemaVersion: 1 as const,
    runId,
    createdAt: new Date().toISOString(),
    commit: git,
    dirty,
    node: process.version,
    react: pkg.dependencies.react,
    hono: pkg.dependencies.hono,
    autocannon: pkg.devDependencies.autocannon,
    playwright: pkg.devDependencies['@playwright/test'],
    os: `${platform()} ${release()} ${hostname()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    memoryBytes: totalmem(),
    profile: profile.name,
    chrome: { channel: 'chrome', version: chromeVersion },
    docker: { context: dockerContext, engineVersion: dockerEngineVersion },
    parameters: {
      connections: profile.connections,
      rounds: profile.rounds,
      warmSegments: profile.warmSegments,
      segmentSeconds: profile.segmentSeconds,
      browserSamples: profile.browserSamples,
      coldSerialPerRound: profile.coldSerialPerRound,
      coldBurstsPerRound: profile.coldBurstsPerRound,
      combinedSamplesPerRound: profile.combinedSamplesPerRound,
      redisTtlSeconds: 30 as const,
      targetCountry: 'gb' as const,
      targetLanguage: 'en-us' as const
    }
  }
}

function report(server: ServerSummary, browserSummary: BrowserSummary) {
  return `# Rendering benchmark (${profile.name})

Run: ${runId}

Results are local-machine observations and are not comparable across machines. CSR shell, catalog BFF, and combined transactions are controls and are never ranked with complete SSR responses. Cold results contain latency samples only; no sustained cold RPS is reported.

## Server segments

| Scenario | Strategy | Cache | Count | p50 ms | p95 ms | p99 ms | RPS | Comparable |
|---|---|---:|---:|---:|---:|---:|---:|---|
${server.results.map(result => `| ${result.scenario} | ${result.strategy} | ${result.cacheCondition} | ${result.count} | ${result.latencyMs.p50.toFixed(2)} | ${result.latencyMs.p95.toFixed(2)} | ${result.latencyMs.p99.toFixed(2)} | ${result.requestsPerSecond?.toFixed(2) ?? 'N/A'} | ${result.comparable ? 'yes' : 'no'} |`).join('\n')}

## CSR combined transaction cost

| Round | Transactions | Requests/transaction | Total requests | Transaction p95 ms | Response bytes p50/p95/p99 |
|---:|---:|---:|---:|---:|---:|
${server.results.filter(result => result.scenario === 'combined').map(result => `| ${result.round} | ${result.count} | ${result.transactionCost!.requestsPerTransaction} | ${result.transactionCost!.totalRequests} | ${result.latencyMs.p95.toFixed(2)} | ${result.transactionCost!.responseBytes.p50.toFixed(0)}/${result.transactionCost!.responseBytes.p95.toFixed(0)}/${result.transactionCost!.responseBytes.p99.toFixed(0)} |`).join('\n')}

## Warm throughput aggregates

${server.warmAggregates.length === 0 ? 'N/A for the single-round quick profile.' : `| Strategy | Cache | Round means RPS | Mean RPS | Student-t 95% CI (df=4) | Comparable |
|---|---:|---:|---:|---:|---|
${server.warmAggregates.map(value => `| ${value.strategy} | ${value.cacheCondition} | ${value.roundMeansRps.map(round => round.toFixed(2)).join(', ')} | ${value.meanRps.toFixed(2)} | ${value.ci95.low.toFixed(2)}–${value.ci95.high.toFixed(2)} | ${value.comparable ? 'yes' : 'no'} |`).join('\n')}`}

## Correctness

${server.correctness.map(value => `- ${value.passed ? 'PASS' : 'FAIL'}: ${value.scenario} — ${JSON.stringify(value.evidence)}`).join('\n')}

## Browser

${browserSummary.results.length} conditions; each has ${profile.browserSamples} measured samples and zero hydration errors. Browser cache evidence is recorded per condition in browser-summary.json and raw/browser/samples.ndjson.
`
}

async function initializeEnvironmentMetadata() {
  dockerContext ||= await capture('docker', ['context', 'show']).catch(() => 'default')
  dockerEngineVersion = await capture('docker', [
    ...(dockerContext ? ['--context', dockerContext] : []),
    'version', '--format', '{{.Server.Version}}'
  ]).catch(() => 'unknown')
  const probe = await chromium.launch({ channel: 'chrome', headless: true })
  chromeVersion = probe.version()
  await probe.close()
}

async function main() {
  if (validateOnly) {
    environmentSchema.parse({
      schemaVersion: 1, runId: 'validate-only', createdAt: new Date().toISOString(), commit: 'validate-only', dirty: false,
      node: process.version, react: '19.2.0', hono: '4.10.6', autocannon: '8.0.0', playwright: '1.59.1',
      os: 'validate-only', cpu: 'validate-only', cpuCount: 1, memoryBytes: 1, profile: profile.name,
      chrome: { channel: 'chrome', version: 'validate-only' }, docker: { context: 'validate-only', engineVersion: 'validate-only' },
      parameters: {
        connections: profile.connections,
        rounds: profile.rounds,
        warmSegments: profile.warmSegments,
        segmentSeconds: profile.segmentSeconds,
        browserSamples: profile.browserSamples,
        coldSerialPerRound: profile.coldSerialPerRound,
        coldBurstsPerRound: profile.coldBurstsPerRound,
        combinedSamplesPerRound: profile.combinedSamplesPerRound,
        redisTtlSeconds: 30,
        targetCountry: 'gb',
        targetLanguage: 'en-us'
      }
    })
    const serverPlan = serverMatrixDescriptorSchema.array().parse(planServerMatrix(profile))
    const browserPlan = browserMatrixDescriptorSchema.array().parse(planBrowserMatrix())
    assertExactServerMatrix(profile, serverPlan)
    assertExactBrowserMatrix(browserPlan)
    serverSummarySchema.parse({ schemaVersion: 1, profile: profile.name, complete: false, results: [], warmAggregates: [], correctness: [] })
    browserSummarySchema.parse({ schemaVersion: 1, profile: profile.name, complete: false, results: [] })
    console.log(`Validated ${profile.name}: ${serverPlan.length} exact server identities + ${browserPlan.length} exact browser identities; no result directory created`)
    return
  }

  await mkdir(rawServer, { recursive: true })
  await mkdir(rawServices, { recursive: true })
  await mkdir(rawBrowser, { recursive: true })
  await writeFile(resolve(resultRoot, 'run.log'), '')
  await initializeEnvironmentMetadata()
  cancellation.throwIfCancelled()
  ;[pagePort, commercePort, redisPort] = await Promise.all([allocatePort(), allocatePort(), allocatePort()])
  const env = {
    ...process.env,
    PAGE_SERVER_HOST: '127.0.0.1',
    PAGE_SERVER_PORT: String(pagePort),
    COMMERCE_API_HOST: '127.0.0.1',
    COMMERCE_API_PORT: String(commercePort),
    COMMERCE_API_URL: `http://127.0.0.1:${commercePort}`,
    PAGE_SERVICE_URL: `http://127.0.0.1:${pagePort}`,
    PAGE_SERVICE_ALLOWED_ORIGINS: `http://127.0.0.1:${pagePort}`,
    REDIS_PORT: String(redisPort),
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    INTERNAL_SERVICE_TOKEN: token,
    SESSION_SIGNING_SECRET: sessionSecret,
    ENABLE_DEMO_ENDPOINTS: 'false',
    NODE_ENV: 'test'
  }
  benchmarkEnvironment = env
  await log('building benchmark services')
  await command('corepack', ['pnpm', '--filter', '@lesshub/commerce-api', 'build'])
  await command('corepack', ['pnpm', '--filter', '@lesshub/hono-react', 'build'])
  cancellation.throwIfCancelled()
  composeStarted = true
  await docker(['up', '-d', '--wait'], env)
  await startCommerce(env)
  await startPage(env)
  cancellation.throwIfCancelled()
  await writeParsed(resolve(resultRoot, 'environment.json'), environmentSchema, await environment())
  const server = await runServer(profile)
  await writeParsed(resolve(resultRoot, 'server-summary.json'), serverSummarySchema, server)
  cancellation.throwIfCancelled()
  const browserSummary = await runBrowser(profile)
  await writeParsed(resolve(resultRoot, 'browser-summary.json'), browserSummarySchema, browserSummary)
  cancellation.throwIfCancelled()
  assertExactServerMatrix(profile, server.results.map(serverDescriptorFromResult))
  assertExactBrowserMatrix(browserSummary.results.map(result => ({
    strategy: result.strategy,
    browserCache: result.browserCache,
    serverCache: result.serverCache
  })))
  await writeFile(resolve(resultRoot, 'benchmark-report.md'), report(server, browserSummary))
  await log('benchmark complete')
}

async function missing(path: string) {
  return await stat(path).then(() => false, () => true)
}

async function writePartial(error: unknown) {
  if (validateOnly) return
  if (partialPromise) return await partialPromise
  partialPromise = (async () => {
    await mkdir(resultRoot, { recursive: true })
    const message = error instanceof Error ? error.message : String(error)
    await appendFile(resolve(resultRoot, 'run.log'), `${new Date().toISOString()} FAILED ${message}\n`).catch(() => {})
    if (await missing(resolve(resultRoot, 'environment.json')))
      await writeParsed(resolve(resultRoot, 'environment.json'), environmentSchema, await environment()).catch(() => {})
    if (await missing(resolve(resultRoot, 'server-summary.json')))
      await writeParsed(resolve(resultRoot, 'server-summary.json'), serverSummarySchema, {
        schemaVersion: 1, profile: profile.name, complete: false, results: [], warmAggregates: [], correctness: [{ scenario: 'partial-run', passed: false, evidence: { error: message } }]
      }).catch(() => {})
    if (await missing(resolve(resultRoot, 'browser-summary.json')))
      await writeParsed(resolve(resultRoot, 'browser-summary.json'), browserSummarySchema, {
        schemaVersion: 1, profile: profile.name, complete: false, results: []
      }).catch(() => {})
    if (await missing(resolve(resultRoot, 'benchmark-report.md')))
      await writeFile(resolve(resultRoot, 'benchmark-report.md'), `# Partial benchmark\n\nRun failed: ${message}\n`).catch(() => {})
  })()
  return await partialPromise
}

async function cleanup() {
  if (cleanupPromise) return await cleanupPromise
  cleanupPromise = (async () => {
    for (const child of commandChildren) child.kill('SIGTERM')
    commandChildren.clear()
    await browser?.close().catch(() => {})
    browser = undefined
    await stopProcess(pageProcess)
    await stopProcess(commerceProcess)
    pageProcess = undefined
    commerceProcess = undefined
    if (composeStarted)
      await docker(['down', '--volumes', '--remove-orphans'], {
        ...process.env,
        REDIS_PORT: String(redisPort)
      }).catch(() => {})
    composeStarted = false
  })()
  return await cleanupPromise
}

const cancellation = createCancellationCoordinator({
  writePartial: async signal => await writePartial(new Error(`Benchmark cancelled by ${signal}`)),
  cleanup
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void cancellation.cancel(signal).then(exitCode => {
      process.exitCode = exitCode
    })
  })
}

let failed: unknown
try {
  await main()
} catch (error) {
  if (!cancellation.cancelled) failed = error
  console.error(error)
  await writePartial(error)
} finally {
  await cleanup()
  if (!validateOnly) console.log(`BENCHMARK_RESULTS_DIR=${resultRoot}`)
}
if (failed && !cancellation.cancelled) process.exitCode = 1
