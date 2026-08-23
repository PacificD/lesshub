import type { BenchmarkProfile } from './profile.js'
import { confidence95 } from './stats.js'

const sustainedStrategies = [
  'html-cache',
  'data-cache',
  'live-ssr',
  'csr-shell',
  'csr-catalog-bff'
] as const

interface WarmSegmentValue {
  scenario: string
  strategy: string
  round: number
  requestsPerSecond: number | null
}

export interface WarmAggregate {
  strategy: (typeof sustainedStrategies)[number]
  cacheCondition: 'warm' | 'N/A'
  comparable: boolean
  roundMeansRps: number[]
  meanRps: number
  ci95: { low: number; high: number }
  units: 'requests/second'
}

export function buildWarmAggregates(
  profile: BenchmarkProfile,
  results: readonly WarmSegmentValue[]
): WarmAggregate[] {
  if (profile.name === 'quick') return []
  return sustainedStrategies.map(strategy => {
    const roundMeansRps = Array.from({ length: profile.rounds }, (_unused, round) => {
      const segments = results.filter(
        result =>
          result.scenario === 'warm' &&
          result.strategy === strategy &&
          result.round === round
      )
      if (segments.length !== profile.warmSegments)
        throw new Error(`${strategy} round ${round} has ${segments.length} warm segments`)
      if (segments.some(segment => segment.requestsPerSecond === null))
        throw new Error(`${strategy} round ${round} has a missing RPS value`)
      return (
        segments.reduce(
          (sum, segment) => sum + segment.requestsPerSecond!,
          0
        ) / segments.length
      )
    })
    const ci95 = confidence95(roundMeansRps)
    if (!ci95) throw new Error(`${strategy} full aggregate is missing Student-t CI`)
    return {
      strategy,
      cacheCondition:
        strategy === 'html-cache' || strategy === 'data-cache'
          ? ('warm' as const)
          : ('N/A' as const),
      comparable:
        strategy === 'html-cache' ||
        strategy === 'data-cache' ||
        strategy === 'live-ssr',
      roundMeansRps,
      meanRps:
        roundMeansRps.reduce((sum, value) => sum + value, 0) /
        roundMeansRps.length,
      ci95,
      units: 'requests/second' as const
    }
  })
}
