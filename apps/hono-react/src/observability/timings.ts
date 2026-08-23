import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export interface MonotonicClock { now(): number }
export const monotonicClock: MonotonicClock = { now: () => performance.now() }

export function safeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function formatServerTiming(
  timings: Record<string, number>,
  coalescing?: { role: 'leader' | 'waiter'; waitMs: number },
  totalMs?: number
): string {
  const entries = ['redis', 'api', 'ssr', 'assemble'].map(
    name => `${name};dur=${safeDuration(timings[name] ?? 0).toFixed(2)}`
  )
  if (coalescing)
    entries.push(`coalesce;dur=${safeDuration(coalescing.waitMs).toFixed(2)};desc="${coalescing.role}"`)
  if (totalMs !== undefined) entries.push(`total;dur=${safeDuration(totalMs).toFixed(2)}`)
  return entries.join(', ')
}

export function cacheKeyHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
