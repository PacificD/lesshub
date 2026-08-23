export function percentiles(values: readonly number[]) {
  const sorted = values
    .map(value => (Number.isFinite(value) ? Math.max(0, value) : 0))
    .sort((left, right) => left - right)
  const at = (percentile: number) =>
    sorted.length === 0
      ? 0
      : sorted[
          Math.min(
            sorted.length - 1,
            Math.ceil((percentile / 100) * sorted.length) - 1
          )
        ]!
  return { p50: at(50), p95: at(95), p99: at(99) }
}

const studentTCritical95: Record<number, number> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228
}

export function confidence95(
  values: readonly number[]
): { low: number; high: number } | null {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1)
  const degreesOfFreedom = values.length - 1
  const critical = studentTCritical95[degreesOfFreedom] ?? 1.96
  const margin = critical * Math.sqrt(variance / values.length)
  return { low: mean - margin, high: mean + margin }
}
