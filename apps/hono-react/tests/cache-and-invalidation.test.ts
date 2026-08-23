import { describe, expect, it, vi } from 'vitest'
import { createRedisPageCache } from '../src/cache/redis-page-cache.js'
import {
  allPageKeys,
  keysForInvalidation
} from '../src/cache/invalidation.js'

class FakeRedis {
  values = new Map<string, string>()
  expiresAt = new Map<string, number>()
  now = 0
  getError = false
  setError = false
  deleted: string[] = []
  setCalls: Array<{ key: string; options: { EX: number } }> = []
  async get(key: string) {
    if (this.getError) throw new Error('redis down')
    const expiry = this.expiresAt.get(key)
    if (expiry !== undefined && this.now >= expiry) {
      this.values.delete(key)
      this.expiresAt.delete(key)
    }
    return this.values.get(key) ?? null
  }
  async set(key: string, value: string, options: { EX: number }) {
    if (this.setError) throw new Error('redis down')
    this.values.set(key, value)
    this.expiresAt.set(key, this.now + options.EX * 1000)
    this.setCalls.push({ key, options })
    return 'OK'
  }
  async del(keys: string | string[]) {
    const list = Array.isArray(keys) ? keys : [keys]
    this.deleted.push(...list)
    for (const key of list) this.values.delete(key)
    return list.length
  }
}

const logger = { info: vi.fn(), error: vi.fn() }

describe('Redis page-cache adapter seam', () => {
  it('stores envelopes with an exact 30 second expiry', async () => {
    const redis = new FakeRedis()
    const cache = createRedisPageCache(redis, logger)
    expect(
      await cache.writeHtml(
        'html',
        { formatVersion: 1, dataVersion: 1, bodyHtml: '<section />' },
        30
      )
    ).toBe(true)
    expect(redis.setCalls[0]).toEqual({ key: 'html', options: { EX: 30 } })
    redis.now = 29_999
    expect(await cache.readHtml('html')).toMatchObject({ status: 'HIT' })
    redis.now = 30_000
    expect(await cache.readHtml('html')).toEqual({ status: 'MISS' })
  })

  it('treats malformed or version-incompatible values as MISS and deletes them', async () => {
    const redis = new FakeRedis()
    redis.values.set('bad-json', '{')
    redis.values.set(
      'bad-version',
      JSON.stringify({ formatVersion: 2, dataVersion: 1, bodyHtml: '<x>' })
    )
    const cache = createRedisPageCache(redis, logger)
    expect(await cache.readHtml('bad-json')).toEqual({ status: 'MISS' })
    expect(await cache.readHtml('bad-version')).toEqual({ status: 'MISS' })
    expect(redis.deleted).toEqual(['bad-json', 'bad-version'])
  })

  it('deletes data envelopes with incompatible schema, versions, or locale binding', async () => {
    const redis = new FakeRedis()
    const payload = {
      countryCode: 'US',
      language: 'en-US',
      currency: 'USD',
      dataVersion: 1,
      products: []
    }
    redis.values.set(
      'schema',
      JSON.stringify({ schemaVersion: 2, dataVersion: 1, payload })
    )
    redis.values.set(
      'version',
      JSON.stringify({ schemaVersion: 1, dataVersion: 2, payload })
    )
    redis.values.set(
      'locale',
      JSON.stringify({ schemaVersion: 1, dataVersion: 1, payload })
    )
    redis.values.set(
      'currency',
      JSON.stringify({
        schemaVersion: 1,
        dataVersion: 1,
        payload: { ...payload, countryCode: 'GB', currency: 'USD' }
      })
    )
    redis.values.set(
      'product-currency',
      JSON.stringify({
        schemaVersion: 1,
        dataVersion: 1,
        payload: {
          ...payload,
          countryCode: 'GB',
          language: 'ja-JP',
          currency: 'GBP',
          products: [
            {
              id: 'product-01',
              slug: 'field-notebook',
              name: 'ノート',
              description: '丈夫なノート',
              category: 'field',
              imageUrl: '/images/product-01.svg',
              priceMinor: 100,
              currency: 'USD',
              inventory: 1,
              availability: 'low-stock',
              updatedAt: '2026-01-01T00:00:00.000Z'
            }
          ]
        }
      })
    )
    const cache = createRedisPageCache(redis, logger)
    const expected = { countryCode: 'GB' as const, language: 'ja-JP' as const }
    for (const key of [
      'schema',
      'version',
      'locale',
      'currency',
      'product-currency'
    ])
      expect(await cache.readData(key, expected)).toEqual({ status: 'MISS' })
    expect(redis.deleted).toEqual([
      'schema',
      'version',
      'locale',
      'currency',
      'product-currency'
    ])
  })

  it('returns BYPASS for read/write transport failures', async () => {
    const redis = new FakeRedis()
    const cache = createRedisPageCache(redis, logger)
    redis.getError = true
    expect(
      await cache.readData('data', {
        countryCode: 'US',
        language: 'en-US'
      })
    ).toEqual({ status: 'BYPASS' })
    redis.setError = true
    expect(
      await cache.writeData(
        'data',
        {
          schemaVersion: 1,
          dataVersion: 1,
          payload: {
            countryCode: 'US',
            language: 'en-US',
            currency: 'USD',
            dataVersion: 1,
            products: []
          }
        },
        30
      )
    ).toBe(false)
  })
})

describe('cache invalidation expansion seam', () => {
  it('expands translation, price, and global events to 8, 6, and 24 keys', () => {
    expect(keysForInvalidation({ type: 'translation', language: 'ja-JP' })).toHaveLength(8)
    expect(keysForInvalidation({ type: 'price', countryCode: 'SG' })).toHaveLength(6)
    expect(keysForInvalidation({ type: 'inventory', scope: 'all' })).toHaveLength(24)
    expect(keysForInvalidation({ type: 'product', scope: 'all' })).toHaveLength(24)
    expect(keysForInvalidation({ type: 'reset', scope: 'all' })).toHaveLength(24)
    expect(new Set(allPageKeys())).toHaveLength(24)
  })
})
