import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { CacheStatus } from '../runtime/interfaces.js'

export interface MetricsSnapshot {
  schemaVersion: 1
  intervalStartedAt: string
  intervalEndedAt: string
  counts: Record<string, number>
  process: {
    cpuUserMicros: number
    cpuSystemMicros: number
    rssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    eventLoopDelayMs: { p50: number; p95: number; p99: number; max: number }
  }
}

export interface MetricsRegistry {
  record(input: {
    strategy?: string
    cacheStatus?: CacheStatus
    responseBytes?: number
    redisReads?: number
    redisWrites?: number
    redisDeletes?: number
    apiCalls?: number
    ssrCalls?: number
    assembleCalls?: number
    coalescingRole?: 'leader' | 'waiter'
    error?: boolean
    degradation?: boolean
  }): void
  snapshot(): MetricsSnapshot
  reset(): void
}

export function createMetricsRegistry(): MetricsRegistry {
  const histogram = monitorEventLoopDelay({ resolution: 10 })
  histogram.enable()
  let startedAt = new Date().toISOString()
  let cpu = process.cpuUsage()
  let counts: Record<string, number> = {}
  const add = (key: string, value = 1) => { counts[key] = (counts[key] ?? 0) + value }
  function reset() {
    counts = {}
    startedAt = new Date().toISOString()
    cpu = process.cpuUsage()
    histogram.reset()
  }
  return {
    record(input) {
      add('requests')
      if (input.strategy) add(`strategy.${input.strategy}`)
      if (input.cacheStatus) add(`cache.${input.cacheStatus}`)
      add('responseBytes', input.responseBytes ?? 0)
      add('redisReads', input.redisReads ?? 0)
      add('redisWrites', input.redisWrites ?? 0)
      add('redisDeletes', input.redisDeletes ?? 0)
      add('apiCalls', input.apiCalls ?? 0)
      add('ssrCalls', input.ssrCalls ?? 0)
      add('assembleCalls', input.assembleCalls ?? 0)
      if (input.coalescingRole) add(`coalescing.${input.coalescingRole}`)
      if (input.error) add('errors')
      if (input.degradation) add('degradations')
    },
    snapshot() {
      const usage = process.memoryUsage()
      const cpuDelta = process.cpuUsage(cpu)
      const ms = (value: number) => Number.isFinite(value) ? value / 1e6 : 0
      return {
        schemaVersion: 1,
        intervalStartedAt: startedAt,
        intervalEndedAt: new Date().toISOString(),
        counts: { ...counts },
        process: {
          cpuUserMicros: cpuDelta.user,
          cpuSystemMicros: cpuDelta.system,
          rssBytes: usage.rss,
          heapUsedBytes: usage.heapUsed,
          heapTotalBytes: usage.heapTotal,
          eventLoopDelayMs: {
            p50: ms(histogram.percentile(50)),
            p95: ms(histogram.percentile(95)),
            p99: ms(histogram.percentile(99)),
            max: ms(histogram.max)
          }
        }
      }
    },
    reset
  }
}
