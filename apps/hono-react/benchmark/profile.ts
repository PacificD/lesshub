import { z } from 'zod'

export const benchmarkProfileSchema = z.object({
  name: z.enum(['quick', 'full']),
  connections: z.number().int().positive(),
  rounds: z.number().int().positive(),
  warmSegments: z.number().int().positive(),
  segmentSeconds: z.number().positive().max(29.999),
  browserSamples: z.number().int().min(10),
  coldSerialPerRound: z.literal(10),
  coldBurstsPerRound: z.literal(3),
  combinedSamplesPerRound: z.literal(10)
}).strict()

export type BenchmarkProfile = z.infer<typeof benchmarkProfileSchema>

export const profiles = {
  quick: benchmarkProfileSchema.parse({ name: 'quick', connections: 10, rounds: 1, warmSegments: 1, segmentSeconds: 10, browserSamples: 10, coldSerialPerRound: 10, coldBurstsPerRound: 3, combinedSamplesPerRound: 10 }),
  full: benchmarkProfileSchema.parse({ name: 'full', connections: 50, rounds: 5, warmSegments: 3, segmentSeconds: 20, browserSamples: 10, coldSerialPerRound: 10, coldBurstsPerRound: 3, combinedSamplesPerRound: 10 })
} satisfies Record<string, BenchmarkProfile>

export function rotateLeft<T>(values: readonly T[], offset: number): T[] {
  if (values.length === 0) return []
  const normalized = ((offset % values.length) + values.length) % values.length
  return [...values.slice(normalized), ...values.slice(0, normalized)]
}

export function rotatedStrategies(round: number) {
  return rotateLeft(
    ['html-cache', 'data-cache', 'live-ssr', 'csr'] as const,
    round
  )
}
