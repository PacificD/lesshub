import { z } from 'zod'
import type { BenchmarkProfile } from './profile.js'

const serverStrategySchema = z.enum([
  'html-cache',
  'data-cache',
  'live-ssr',
  'csr-shell',
  'csr-catalog-bff',
  'csr-combined'
])

export const serverMatrixDescriptorSchema = z
  .object({
    round: z.number().int().nonnegative(),
    segment: z.string().min(1),
    scenario: z.enum(['warm', 'cold', 'cold-burst', 'combined']),
    strategy: serverStrategySchema,
    cacheCondition: z.enum(['warm', 'cold', 'N/A']),
    comparable: z.boolean()
  })
  .strict()

export const browserMatrixDescriptorSchema = z
  .object({
    strategy: z.enum(['html-cache', 'data-cache', 'live-ssr', 'csr']),
    browserCache: z.enum(['cold', 'warm']),
    serverCache: z.enum(['cold', 'warm', 'N/A'])
  })
  .strict()

export type ServerMatrixDescriptor = z.infer<typeof serverMatrixDescriptorSchema>
export type BrowserMatrixDescriptor = z.infer<typeof browserMatrixDescriptorSchema>

const pageStrategies = ['html-cache', 'data-cache', 'live-ssr', 'csr-shell'] as const
const sustainedStrategies = [
  'html-cache',
  'data-cache',
  'live-ssr',
  'csr-shell',
  'csr-catalog-bff'
] as const

function cacheCondition(
  strategy: ServerMatrixDescriptor['strategy'],
  scenario: ServerMatrixDescriptor['scenario']
): ServerMatrixDescriptor['cacheCondition'] {
  if (strategy !== 'html-cache' && strategy !== 'data-cache') return 'N/A'
  return scenario === 'warm' ? 'warm' : 'cold'
}

function comparable(strategy: ServerMatrixDescriptor['strategy']): boolean {
  return strategy === 'html-cache' || strategy === 'data-cache' || strategy === 'live-ssr'
}

export function planServerMatrix(profile: BenchmarkProfile): ServerMatrixDescriptor[] {
  const plan: ServerMatrixDescriptor[] = []
  for (let round = 0; round < profile.rounds; round += 1) {
    for (const strategy of sustainedStrategies)
      for (let segment = 0; segment < profile.warmSegments; segment += 1)
        plan.push({
          round,
          segment: `warm-${segment}`,
          scenario: 'warm',
          strategy,
          cacheCondition: cacheCondition(strategy, 'warm'),
          comparable: comparable(strategy)
        })
    for (const strategy of pageStrategies) {
      plan.push({
        round,
        segment: 'serial',
        scenario: 'cold',
        strategy,
        cacheCondition: cacheCondition(strategy, 'cold'),
        comparable: comparable(strategy)
      })
      for (let burst = 0; burst < profile.coldBurstsPerRound; burst += 1)
        plan.push({
          round,
          segment: `burst-${burst}`,
          scenario: 'cold-burst',
          strategy,
          cacheCondition: cacheCondition(strategy, 'cold-burst'),
          comparable: comparable(strategy)
        })
    }
    plan.push({
      round,
      segment: 'combined',
      scenario: 'combined',
      strategy: 'csr-combined',
      cacheCondition: 'N/A',
      comparable: false
    })
  }
  return serverMatrixDescriptorSchema.array().parse(plan)
}

export function planBrowserMatrix(): BrowserMatrixDescriptor[] {
  const plan: BrowserMatrixDescriptor[] = []
  for (const strategy of ['html-cache', 'data-cache'] as const)
    for (const browserCache of ['cold', 'warm'] as const)
      for (const serverCache of ['cold', 'warm'] as const)
        plan.push({ strategy, browserCache, serverCache })
  for (const strategy of ['live-ssr', 'csr'] as const)
    for (const browserCache of ['cold', 'warm'] as const)
      plan.push({ strategy, browserCache, serverCache: 'N/A' })
  return browserMatrixDescriptorSchema.array().parse(plan)
}

function identity(value: object): string {
  return JSON.stringify(value)
}

function assertExact<T extends object>(label: string, expected: readonly T[], actual: readonly T[]) {
  const actualKeys = actual.map(identity)
  if (new Set(actualKeys).size !== actualKeys.length)
    throw new Error(`${label} matrix contains duplicate identities`)
  const expectedKeys = new Set(expected.map(identity))
  const actualSet = new Set(actualKeys)
  const missing = [...expectedKeys].filter(key => !actualSet.has(key))
  const extra = [...actualSet].filter(key => !expectedKeys.has(key))
  if (missing.length || extra.length)
    throw new Error(`${label} matrix mismatch: missing=${missing.length}, extra=${extra.length}`)
}

export function assertExactServerMatrix(
  profile: BenchmarkProfile,
  actual: readonly ServerMatrixDescriptor[]
): void {
  const parsed = serverMatrixDescriptorSchema.array().parse(actual)
  assertExact('server', planServerMatrix(profile), parsed)
}

export function assertExactBrowserMatrix(actual: readonly BrowserMatrixDescriptor[]): void {
  const parsed = browserMatrixDescriptorSchema.array().parse(actual)
  assertExact('browser', planBrowserMatrix(), parsed)
}

export function serverDescriptorFromResult(value: {
  round: number
  segment: string
  scenario: ServerMatrixDescriptor['scenario']
  strategy: ServerMatrixDescriptor['strategy']
  cacheCondition: ServerMatrixDescriptor['cacheCondition']
  comparable: boolean
}): ServerMatrixDescriptor {
  return serverMatrixDescriptorSchema.parse({
    round: value.round,
    segment: value.segment,
    scenario: value.scenario,
    strategy: value.strategy,
    cacheCondition: value.cacheCondition,
    comparable: value.comparable
  })
}

export function assertExactRawServerArtifacts(
  profile: BenchmarkProfile,
  results: readonly ({ id: string } & ServerMatrixDescriptor)[],
  fileNames: readonly string[]
): void {
  assertExactServerMatrix(profile, results.map(serverDescriptorFromResult))
  const expected = results.map(result => `${result.id}.json`)
  const uniqueExpected = new Set(expected)
  if (uniqueExpected.size !== expected.length)
    throw new Error('raw server artifact plan contains duplicate file identities')
  const uniqueActual = new Set(fileNames)
  if (uniqueActual.size !== fileNames.length)
    throw new Error('raw server artifacts contain duplicate file identities')
  const missing = [...uniqueExpected].filter(fileName => !uniqueActual.has(fileName))
  const extra = [...uniqueActual].filter(fileName => !uniqueExpected.has(fileName))
  if (missing.length || extra.length)
    throw new Error(
      `raw server artifact mismatch: expected=${expected.length}, actual=${fileNames.length}, missing=${missing.length}, extra=${extra.length}`
    )
}

export interface BrowserCacheEvidenceValue {
  measuredSamples: number
  assetRequests: number
  cacheHits: number
  networkTransfers: number
}

export function validateAutocannonResult(input: {
  non2xx: number
  errors: number
  timeouts: number
  mismatches: number
  resets: number
}): void {
  const failures = Object.entries(input).filter(([, value]) => value !== 0)
  if (failures.length)
    throw new Error(
      `Load generator correctness failure: ${failures
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')}`
    )
}

export function assertBrowserCacheEvidence(
  condition: 'cold' | 'warm',
  evidence: BrowserCacheEvidenceValue,
  requiredAssetsPerSample: number
): void {
  const minimum = evidence.measuredSamples * requiredAssetsPerSample
  if (evidence.assetRequests < minimum)
    throw new Error(
      `${condition} browser evidence saw ${evidence.assetRequests}/${minimum} required asset requests`
    )
  if (condition === 'warm') {
    if (evidence.cacheHits < minimum)
      throw new Error(
        `Warm browser evidence saw ${evidence.cacheHits}/${minimum} required cache hits`
      )
  } else if (evidence.cacheHits !== 0 || evidence.networkTransfers < minimum) {
    throw new Error(
      `Cold browser evidence expected network transfer for ${minimum} assets; hits=${evidence.cacheHits}, transfers=${evidence.networkTransfers}`
    )
  }
}
