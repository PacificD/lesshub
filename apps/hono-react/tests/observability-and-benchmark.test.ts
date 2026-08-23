import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createMetricsRegistry } from '../src/observability/metrics.js'
import { cacheKeyHash, formatServerTiming, safeDuration } from '../src/observability/timings.js'
import { consoleLogger, sanitizeLogValue } from '../src/observability/logger.js'
import {
  browserSummarySchema,
  environmentSchema,
  serverSummarySchema
} from '../benchmark/schema.js'
import { profiles, rotateLeft, rotatedStrategies } from '../benchmark/profile.js'
import {
  assertBrowserCacheEvidence,
  assertExactBrowserMatrix,
  assertExactRawServerArtifacts,
  assertExactServerMatrix,
  browserMatrixDescriptorSchema,
  planBrowserMatrix,
  planServerMatrix,
  serverMatrixDescriptorSchema,
  validateAutocannonResult
} from '../benchmark/protocol.js'
import { createCancellationCoordinator } from '../benchmark/cancellation.js'
import { buildWarmAggregates } from '../benchmark/aggregates.js'
import { transferBytesForExtension } from '../benchmark/resource-transfer.js'
import { confidence95, percentiles } from '../benchmark/stats.js'

describe('observability seams', () => {
  it('formats fixed-order finite nonnegative Server-Timing values and hashes cache keys', () => {
    expect(formatServerTiming({ assemble: 4, ssr: 3, api: Number.NaN, redis: -1 }, { role: 'waiter', waitMs: 5 }, 8)).toBe('redis;dur=0.00, api;dur=0.00, ssr;dur=3.00, assemble;dur=4.00, coalesce;dur=5.00;desc="waiter", total;dur=8.00')
    expect(safeDuration(Number.POSITIVE_INFINITY)).toBe(0)
    const hash = cacheKeyHash('v1:page-html:GB:en-US:products-list')
    expect(hash).toMatch(/^[a-f0-9]{16}$/)
    expect(hash).not.toContain('page-html')
  })

  it('takes interval snapshots and resets counters', () => {
    const registry = createMetricsRegistry()
    registry.record({ strategy: 'html-cache', cacheStatus: 'MISS', responseBytes: 100, redisReads: 1, redisWrites: 1, apiCalls: 1, ssrCalls: 1, assembleCalls: 1, coalescingRole: 'leader' })
    expect(registry.snapshot().counts).toMatchObject({ requests: 1, 'strategy.html-cache': 1, 'cache.MISS': 1, responseBytes: 100, redisReads: 1, redisWrites: 1, apiCalls: 1, ssrCalls: 1, assembleCalls: 1, 'coalescing.leader': 1 })
    registry.reset()
    expect(registry.snapshot().counts).toEqual({})
  })

  it('adds an ISO timestamp to console logs without overwriting an existing one', () => {
    const output: string[] = []
    const original = console.log
    console.log = value => output.push(String(value))
    try {
      consoleLogger.info({ event: 'test' })
      consoleLogger.info({ event: 'test', timestamp: '2026-01-01T00:00:00.000Z' })
    } finally {
      console.log = original
    }
    expect(JSON.parse(output[0]!).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(JSON.parse(output[1]!).timestamp).toBe('2026-01-01T00:00:00.000Z')
  })

  it('recursively removes sensitive log aliases without removing safe hashes or routes', () => {
    const clean = sanitizeLogValue({
      requestId: 'r',
      ApiTokenValue: 'secret',
      signing_secret: 'secret',
      PASSWORD_HASH: 'secret',
      nested: {
        setCookie: 'secret',
        sessionPayload: 'secret',
        'user-id': 'secret',
        redis_key: 'secret',
        authorizationHeader: 'secret',
        credentialValue: 'secret',
        upstreamUrl: 'secret',
        cacheKeyHash: 'safe-hash',
        route: '/safe'
      },
      stack: 'trace'
    })
    expect(clean).toEqual({
      requestId: 'r',
      nested: { cacheKeyHash: 'safe-hash', route: '/safe' }
    })
    expect(JSON.stringify(clean)).not.toContain('secret')
  })
})

describe('benchmark protocol and schema seams', () => {
  it('keeps Playwright and failure-runner safety enabled', () => {
    const config = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8')
    expect(config).toMatch(/forbidOnly:\s*true/)
    const failureGate = readFileSync(resolve(process.cwd(), 'scripts/run-failure-gate.mjs'), 'utf8')
    expect(failureGate).toMatch(/await run\('docker', composeArgs\(\['start', 'redis'\]\)\)/)
    const e2eRunner = readFileSync(resolve(process.cwd(), 'scripts/run-e2e.mjs'), 'utf8')
    expect(e2eRunner.indexOf('composeStarted = true')).toBeLessThan(e2eRunner.indexOf("dockerArgs, 'up', '-d', '--wait'"))
  })
  it('locks profiles and deterministically left-rotates browser sample order', () => {
    expect(profiles.quick).toMatchObject({ connections: 10, rounds: 1, warmSegments: 1, segmentSeconds: 10, browserSamples: 10 })
    expect(profiles.full).toMatchObject({ connections: 50, rounds: 5, warmSegments: 3, segmentSeconds: 20, browserSamples: 10 })
    expect(profiles.full.warmSegments * profiles.full.segmentSeconds).toBe(60)
    expect(profiles.full.segmentSeconds).toBeLessThan(30)
    expect(rotatedStrategies(1)[0]).toBe('data-cache')
    expect(rotateLeft(['a', 'b', 'c', 'd'], 0)).toEqual(['a', 'b', 'c', 'd'])
    expect(rotateLeft(['a', 'b', 'c', 'd'], 1)).toEqual(['b', 'c', 'd', 'a'])
    expect(rotateLeft(['a', 'b', 'c', 'd'], 5)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('plans and strictly validates all 22/160 server and 12 browser identities', () => {
    const quick = planServerMatrix(profiles.quick)
    const full = planServerMatrix(profiles.full)
    const browsers = planBrowserMatrix()
    expect(quick).toHaveLength(22)
    expect(full).toHaveLength(160)
    expect(browsers).toHaveLength(12)
    expect(() => serverMatrixDescriptorSchema.array().parse(full)).not.toThrow()
    expect(() => browserMatrixDescriptorSchema.array().parse(browsers)).not.toThrow()
    expect(() => assertExactServerMatrix(profiles.quick, quick)).not.toThrow()
    expect(() => assertExactBrowserMatrix(browsers)).not.toThrow()
    expect(() => assertExactServerMatrix(profiles.quick, quick.slice(1))).toThrow(/matrix/)
    expect(() => assertExactServerMatrix(profiles.quick, [...quick, quick[0]!])).toThrow(/duplicate/)
    expect(() => assertExactBrowserMatrix([...browsers, browsers[0]!])).toThrow(/duplicate/)
  })

  it('calculates exact observed percentiles and Student-t confidence intervals', () => {
    expect(percentiles([1, 2, 3, 4, 5])).toEqual({ p50: 3, p95: 5, p99: 5 })
    expect(confidence95([10])).toBeNull()
    const interval = confidence95([8, 9, 10, 11, 12])
    expect(interval).not.toBeNull()
    expect(interval!.low).toBeCloseTo(8.037, 3)
    expect(interval!.high).toBeCloseTo(11.963, 3)
  })

  it('rejects invalid, duplicate, and incomplete semantic summary matrices', () => {
    const result = {
      id: 'x', scenario: 'warm', strategy: 'live-ssr', cacheCondition: 'warm', comparable: true,
      round: 0, count: 1, errors: 0, timeouts: 0,
      latencyMs: { p50: 1, p95: 1, p99: 1 }, requestsPerSecond: 1,
      units: { latency: 'ms', throughput: 'requests/second' }
    }
    expect(() => serverSummarySchema.parse({ schemaVersion: 1, profile: 'quick', complete: false, results: [result], warmAggregates: [], correctness: [] })).toThrow(z.ZodError)
    expect(() => browserSummarySchema.parse({ schemaVersion: 1, profile: 'quick', complete: false, results: [{
      strategy: 'csr', browserCache: 'cold', serverCache: 'warm', samples: 10, hydrationErrors: 0,
      ttfbMs: { p50: 1, p95: 1, p99: 1 }, fcpMs: { p50: 1, p95: 1, p99: 1 }, lcpMs: { p50: 1, p95: 1, p99: 1 },
      productVisibleMs: { p50: 1, p95: 1, p99: 1 }, userMenuReadyMs: { p50: 1, p95: 1, p99: 1 }, catalogMs: { p50: 1, p95: 1, p99: 1 },
      jsTransferBytes: { p50: 1, p95: 1, p99: 1 }, cssTransferBytes: { p50: 1, p95: 1, p99: 1 },
      cacheEvidence: { measuredSamples: 10, assetRequests: 20, cacheHits: 0, networkTransfers: 20 }
    }] })).toThrow(z.ZodError)
    const planned = planServerMatrix(profiles.quick).map((descriptor, index) => ({
      id: `result-${index}`,
      ...descriptor,
      count: 1,
      errors: 0,
      timeouts: 0,
      latencyMs: { p50: 1, p95: 1, p99: 1 },
      requestsPerSecond: descriptor.scenario === 'warm' ? 1 : null,
      ...(descriptor.scenario === 'combined'
        ? {
            transactionCost: {
              requestsPerTransaction: 2 as const,
              totalRequests: 2,
              responseBytes: { p50: 1, p95: 1, p99: 1 }
            }
          }
        : {}),
      units: { latency: 'ms' as const, throughput: 'requests/second' as const }
    }))
    const summary = { schemaVersion: 1 as const, profile: 'quick' as const, complete: true, results: planned, warmAggregates: [], correctness: [] }
    expect(() => serverSummarySchema.parse(summary)).not.toThrow()
    const combinedWithoutCost = planned.map(result =>
      result.scenario === 'combined'
        ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'transactionCost'))
        : result
    )
    expect(() => serverSummarySchema.parse({ ...summary, results: combinedWithoutCost })).toThrow(z.ZodError)
    expect(() => serverSummarySchema.parse({ ...summary, results: [...planned, planned[0]!] })).toThrow(z.ZodError)
    expect(() => serverSummarySchema.parse({ ...summary, results: planned.slice(1) })).toThrow(z.ZodError)
  })

  it('keeps full Student-t intervals only on five endpoint aggregates', () => {
    const fullResults = planServerMatrix(profiles.full).map((descriptor, index) => ({
      id: `result-${index}`,
      ...descriptor,
      count: 1,
      errors: 0,
      timeouts: 0,
      latencyMs: { p50: 1, p95: 1, p99: 1 },
      requestsPerSecond: descriptor.scenario === 'warm' ? 10 : null,
      ...(descriptor.scenario === 'combined'
        ? {
            transactionCost: {
              requestsPerTransaction: 2 as const,
              totalRequests: 2,
              responseBytes: { p50: 1, p95: 1, p99: 1 }
            }
          }
        : {}),
      units: { latency: 'ms' as const, throughput: 'requests/second' as const }
    }))
    const aggregates = ['html-cache', 'data-cache', 'live-ssr', 'csr-shell', 'csr-catalog-bff'].map(strategy => ({
      strategy,
      cacheCondition: strategy === 'html-cache' || strategy === 'data-cache' ? 'warm' : 'N/A',
      comparable: !strategy.startsWith('csr-'),
      roundMeansRps: [10, 10, 10, 10, 10],
      meanRps: 10,
      ci95: { low: 10, high: 10 },
      units: 'requests/second'
    }))
    expect(() => serverSummarySchema.parse({ schemaVersion: 1, profile: 'full', complete: true, results: fullResults, warmAggregates: aggregates, correctness: [] })).not.toThrow()
    expect(() => serverSummarySchema.parse({ schemaVersion: 1, profile: 'full', complete: true, results: fullResults, warmAggregates: aggregates.slice(1), correctness: [] })).toThrow(z.ZodError)

    const measured = fullResults.map(result => ({
      ...result,
      requestsPerSecond: result.scenario === 'warm' ? 100 + result.round * 10 : null
    }))
    const built = buildWarmAggregates(profiles.full, measured)
    expect(built).toHaveLength(5)
    expect(built[0]).toMatchObject({
      strategy: 'html-cache',
      roundMeansRps: [100, 110, 120, 130, 140],
      meanRps: 120,
      ci95: { low: expect.any(Number), high: expect.any(Number) }
    })
    expect(buildWarmAggregates(profiles.quick, [])).toEqual([])
  })

  it('fails bad load-generator output and browser cache evidence', () => {
    expect(() => validateAutocannonResult({ non2xx: 1, errors: 0, timeouts: 0, mismatches: 0, resets: 0 })).toThrow()
    expect(() => validateAutocannonResult({ non2xx: 0, errors: 0, timeouts: 0, mismatches: 0, resets: 0 })).not.toThrow()
    expect(() => assertBrowserCacheEvidence('warm', { measuredSamples: 10, assetRequests: 20, cacheHits: 9, networkTransfers: 11 }, 2)).toThrow()
    expect(() => assertBrowserCacheEvidence('warm', { measuredSamples: 10, assetRequests: 20, cacheHits: 20, networkTransfers: 0 }, 2)).not.toThrow()
    expect(() => assertBrowserCacheEvidence('cold', { measuredSamples: 10, assetRequests: 20, cacheHits: 0, networkTransfers: 20 }, 2)).not.toThrow()
  })

  it('counts transfer bytes strictly by URL extension, including query strings', () => {
    const resources = [
      { name: 'https://shop.test/assets/global-abc.css', bytes: 120, type: 'link' },
      { name: 'https://shop.test/assets/client-def.js?v=1', bytes: 80, type: 'script' },
      { name: 'https://shop.test/images/field.svg', bytes: 700, type: 'css' },
      { name: 'https://shop.test/images/paper.png?size=2', bytes: 900, type: 'css' },
      { name: 'https://shop.test/assets/print.css?v=2', bytes: 30, type: 'other' }
    ]
    expect(transferBytesForExtension(resources, 'css')).toBe(150)
    expect(transferBytesForExtension(resources, 'js')).toBe(80)
  })

  it('requires one raw server artifact for every result identity', () => {
    const results = planServerMatrix(profiles.quick).map((descriptor, index) => ({
      id: `artifact-${index}`,
      ...descriptor
    }))
    const files = results.map(result => `${result.id}.json`)
    expect(() => assertExactRawServerArtifacts(profiles.quick, results, files)).not.toThrow()
    expect(() => assertExactRawServerArtifacts(profiles.quick, results, files.slice(1))).toThrow(/raw server artifact mismatch/)
    expect(() => assertExactRawServerArtifacts(profiles.quick, results, [...files, 'extra.json'])).toThrow(/raw server artifact mismatch/)
  })

  it('coordinates cancellation and cleanup idempotently', async () => {
    const events: string[] = []
    const coordinator = createCancellationCoordinator({
      writePartial: async reason => {
        events.push(`partial:${reason}`)
      },
      cleanup: async () => {
        events.push('cleanup')
      }
    })
    expect(coordinator.cancelled).toBe(false)
    const [first, second] = await Promise.all([
      coordinator.cancel('SIGINT'),
      coordinator.cancel('SIGTERM')
    ])
    expect(first).toBe(130)
    expect(second).toBe(130)
    expect(coordinator.cancelled).toBe(true)
    expect(coordinator.signal.aborted).toBe(true)
    expect(events).toEqual(['partial:SIGINT', 'cleanup'])
    expect(() => coordinator.throwIfCancelled()).toThrow(/SIGINT/)
  })

  it('allows explicitly incomplete partial report artifacts', () => {
    expect(() => environmentSchema.parse({ schemaVersion: 1 })).toThrow(z.ZodError)
    expect(serverSummarySchema.parse({ schemaVersion: 1, profile: 'quick', complete: false, results: [], warmAggregates: [], correctness: [] }).results).toEqual([])
    expect(browserSummarySchema.parse({ schemaVersion: 1, profile: 'quick', complete: false, results: [] }).results).toEqual([])
  })
})
