import { z } from 'zod'
import { profiles } from './profile.js'
import {
  assertExactBrowserMatrix,
  assertExactServerMatrix,
  serverDescriptorFromResult
} from './protocol.js'

const finiteNonnegative = z.number().finite().nonnegative()
const percentileSchema = z
  .object({ p50: finiteNonnegative, p95: finiteNonnegative, p99: finiteNonnegative })
  .strict()

export const environmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    createdAt: z.string().datetime(),
    commit: z.string(),
    dirty: z.boolean(),
    node: z.string(),
    react: z.string(),
    hono: z.string(),
    autocannon: z.string(),
    playwright: z.string(),
    os: z.string(),
    cpu: z.string(),
    cpuCount: z.number().int().positive(),
    memoryBytes: z.number().positive(),
    profile: z.enum(['quick', 'full']),
    chrome: z.object({ channel: z.string(), version: z.string() }).strict(),
    docker: z.object({ context: z.string(), engineVersion: z.string() }).strict(),
    parameters: z.object({
      connections: z.number().int().positive(),
      rounds: z.number().int().positive(),
      warmSegments: z.number().int().positive(),
      segmentSeconds: z.number().positive(),
      browserSamples: z.number().int().min(10),
      coldSerialPerRound: z.number().int().positive(),
      coldBurstsPerRound: z.number().int().positive(),
      combinedSamplesPerRound: z.number().int().positive(),
      redisTtlSeconds: z.literal(30),
      targetCountry: z.literal('gb'),
      targetLanguage: z.literal('en-us')
    }).strict()
  })
  .strict()

const serverStrategySchema = z.enum([
  'html-cache',
  'data-cache',
  'live-ssr',
  'csr-shell',
  'csr-catalog-bff',
  'csr-combined'
])

const resultSchema = z
  .object({
    id: z.string(),
    segment: z.string().min(1),
    scenario: z.enum(['warm', 'cold', 'cold-burst', 'combined']),
    strategy: serverStrategySchema,
    cacheCondition: z.enum(['warm', 'cold', 'N/A']),
    comparable: z.boolean(),
    round: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    timeouts: z.number().int().nonnegative(),
    latencyMs: percentileSchema,
    requestsPerSecond: z.number().finite().nonnegative().nullable(),
    transactionCost: z
      .object({
        requestsPerTransaction: z.literal(2),
        totalRequests: z.number().int().positive(),
        responseBytes: percentileSchema
      })
      .strict()
      .optional(),
    units: z
      .object({ latency: z.literal('ms'), throughput: z.literal('requests/second') })
      .strict()
  })
  .strict()
  .superRefine((value, context) => {
    const cached = value.strategy === 'html-cache' || value.strategy === 'data-cache'
    const csr = value.strategy.startsWith('csr-')
    const expectedCache = cached
      ? value.scenario === 'warm'
        ? 'warm'
        : 'cold'
      : 'N/A'
    if (value.cacheCondition !== expectedCache)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cacheCondition'], message: `requires ${expectedCache}` })
    if (value.comparable !== !csr)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['comparable'], message: `requires ${!csr}` })
    const validScenario =
      value.scenario === 'warm'
        ? value.strategy !== 'csr-combined'
        : value.scenario === 'combined'
          ? value.strategy === 'csr-combined'
          : value.strategy !== 'csr-catalog-bff' && value.strategy !== 'csr-combined'
    if (!validScenario)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['scenario'], message: 'illegal scenario/strategy combination' })
    const expectedRps = value.scenario === 'warm'
    if (expectedRps ? value.requestsPerSecond === null : value.requestsPerSecond !== null)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['requestsPerSecond'], message: expectedRps ? 'warm rows require RPS' : 'non-warm rows prohibit RPS' })
    const combined = value.scenario === 'combined'
    if (combined ? value.transactionCost === undefined : value.transactionCost !== undefined)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['transactionCost'], message: combined ? 'combined rows require transaction cost' : 'only combined rows may contain transaction cost' })
    if (value.transactionCost && value.transactionCost.totalRequests !== value.count * value.transactionCost.requestsPerTransaction)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['transactionCost', 'totalRequests'], message: 'total requests must equal transaction count times requests per transaction' })
  })

const aggregateStrategySchema = z.enum([
  'html-cache',
  'data-cache',
  'live-ssr',
  'csr-shell',
  'csr-catalog-bff'
])

const warmAggregateSchema = z
  .object({
    strategy: aggregateStrategySchema,
    cacheCondition: z.enum(['warm', 'N/A']),
    comparable: z.boolean(),
    roundMeansRps: z.array(z.number().finite().nonnegative()).length(5),
    meanRps: z.number().finite().nonnegative(),
    ci95: z.object({ low: z.number().finite(), high: z.number().finite() }).strict(),
    units: z.literal('requests/second')
  })
  .strict()
  .superRefine((value, context) => {
    const cached = value.strategy === 'html-cache' || value.strategy === 'data-cache'
    const csr = value.strategy.startsWith('csr-')
    if (value.cacheCondition !== (cached ? 'warm' : 'N/A'))
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['cacheCondition'], message: 'aggregate cache condition mismatch' })
    if (value.comparable !== !csr)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['comparable'], message: 'aggregate comparability mismatch' })
  })

export const serverSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.enum(['quick', 'full']),
    complete: z.boolean(),
    results: z.array(resultSchema),
    warmAggregates: z.array(warmAggregateSchema),
    correctness: z.array(
      z.object({
        scenario: z.string(),
        passed: z.boolean(),
        evidence: z.record(z.string(), z.unknown())
      }).strict()
    )
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.complete) return
    try {
      assertExactServerMatrix(
        profiles[value.profile],
        value.results.map(serverDescriptorFromResult)
      )
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['results'], message: String(error) })
    }
    if (value.profile === 'quick' && value.warmAggregates.length !== 0)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['warmAggregates'], message: 'quick profile prohibits aggregates' })
    if (value.profile === 'full') {
      const expected = new Set(aggregateStrategySchema.options)
      const actual = value.warmAggregates.map(item => item.strategy)
      if (new Set(actual).size !== actual.length || actual.length !== expected.size || actual.some(item => !expected.has(item)))
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['warmAggregates'], message: 'full profile requires one aggregate per sustained endpoint' })
    }
  })

export const browserCacheEvidenceSchema = z
  .object({
    measuredSamples: z.number().int().positive(),
    assetRequests: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    networkTransfers: z.number().int().nonnegative()
  })
  .strict()

const browserResultSchema = z
  .object({
    strategy: z.enum(['html-cache', 'data-cache', 'live-ssr', 'csr']),
    browserCache: z.enum(['cold', 'warm']),
    serverCache: z.enum(['cold', 'warm', 'N/A']),
    samples: z.number().int().min(10),
    hydrationErrors: z.literal(0),
    ttfbMs: percentileSchema,
    fcpMs: percentileSchema,
    lcpMs: percentileSchema,
    productVisibleMs: percentileSchema,
    userMenuReadyMs: percentileSchema,
    catalogMs: percentileSchema.nullable(),
    jsTransferBytes: percentileSchema,
    cssTransferBytes: percentileSchema,
    cacheEvidence: browserCacheEvidenceSchema
  })
  .strict()
  .superRefine((value, context) => {
    const cached = value.strategy === 'html-cache' || value.strategy === 'data-cache'
    if (cached ? value.serverCache === 'N/A' : value.serverCache !== 'N/A')
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['serverCache'], message: cached ? 'cached strategies require cold/warm' : 'control strategies require N/A' })
    if (value.strategy === 'csr' ? value.catalogMs === null : value.catalogMs !== null)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['catalogMs'], message: 'catalogMs is required only for CSR' })
  })

export const browserSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.enum(['quick', 'full']),
    complete: z.boolean(),
    results: z.array(browserResultSchema)
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.complete) return
    try {
      assertExactBrowserMatrix(value.results.map(result => ({
        strategy: result.strategy,
        browserCache: result.browserCache,
        serverCache: result.serverCache
      })))
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['results'], message: String(error) })
    }
  })

export type ServerSummary = z.infer<typeof serverSummarySchema>
export type BrowserSummary = z.infer<typeof browserSummarySchema>
export type BrowserCacheEvidence = z.infer<typeof browserCacheEvidenceSchema>
