import type { RequestCoalescer } from '../runtime/interfaces.js'

interface RequestCoalescerOptions {
  now?: () => number
}

export class CoalescingError extends Error {
  readonly role: 'leader' | 'waiter'
  readonly waitMs: number

  constructor(role: 'leader' | 'waiter', waitMs: number) {
    super('Coalesced request failed')
    this.name = 'CoalescingError'
    this.role = role
    this.waitMs = waitMs
  }
}

export function createRequestCoalescer(
  options: RequestCoalescerOptions = {}
): RequestCoalescer {
  const now = options.now ?? (() => performance.now())
  const active = new Map<string, Promise<unknown>>()

  return {
    async run<T>(key: string, work: () => Promise<T>) {
      const existing = active.get(key) as Promise<T> | undefined
      if (existing) {
        const started = now()
        try {
          const value = await existing
          return {
            value,
            role: 'waiter' as const,
            waitMs: Math.max(0, now() - started)
          }
        } catch {
          throw new CoalescingError('waiter', Math.max(0, now() - started))
        }
      }

      const promise = Promise.resolve().then(work)
      active.set(key, promise)
      try {
        try {
          return {
            value: await promise,
            role: 'leader' as const,
            waitMs: 0
          }
        } catch {
          throw new CoalescingError('leader', 0)
        }
      } finally {
        if (active.get(key) === promise) active.delete(key)
      }
    }
  }
}
