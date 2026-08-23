import { describe, expect, it } from 'vitest'
import {
  CoalescingError,
  createRequestCoalescer
} from '../src/cache/request-coalescer.js'

describe('request coalescer observation seam', () => {
  it('reports one leader and each waiter own wait duration without sharing timing state', async () => {
    let now = 0
    let release!: (value: string) => void
    const work = new Promise<string>(resolve => {
      release = resolve
    })
    const coalescer = createRequestCoalescer({ now: () => now })
    const leader = coalescer.run('catalog', () => work)
    await Promise.resolve()
    now = 10
    const waiter = coalescer.run('catalog', () =>
      Promise.reject(new Error('waiter work must not run'))
    )
    now = 35
    release('catalog')

    await expect(leader).resolves.toEqual({
      value: 'catalog',
      role: 'leader',
      waitMs: 0
    })
    await expect(waiter).resolves.toEqual({
      value: 'catalog',
      role: 'waiter',
      waitMs: 25
    })
  })

  it('preserves leader and waiter metadata when shared work rejects without exposing the cause', async () => {
    let now = 0
    let reject!: (error: Error) => void
    const work = new Promise<string>((_resolve, rejectWork) => {
      reject = rejectWork
    })
    const coalescer = createRequestCoalescer({ now: () => now })
    const leader = coalescer.run('catalog', () => work)
    await Promise.resolve()
    now = 10
    const waiter = coalescer.run('catalog', () =>
      Promise.reject(new Error('waiter work must not run'))
    )
    now = 35
    reject(new Error('sensitive upstream detail'))

    const leaderError = await leader.catch(error => error)
    const waiterError = await waiter.catch(error => error)
    expect(leaderError).toBeInstanceOf(CoalescingError)
    expect(leaderError).toMatchObject({ role: 'leader', waitMs: 0 })
    expect(waiterError).toBeInstanceOf(CoalescingError)
    expect(waiterError).toMatchObject({ role: 'waiter', waitMs: 25 })
    expect(String(leaderError)).not.toContain('sensitive upstream detail')
    expect(String(waiterError)).not.toContain('sensitive upstream detail')
    expect(leaderError).not.toHaveProperty('cause')
    expect(waiterError).not.toHaveProperty('cause')
  })
})
