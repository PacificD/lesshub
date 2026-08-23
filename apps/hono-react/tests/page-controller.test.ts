import { describe, expect, it, vi } from 'vitest'
import type { CatalogResponse } from '@lesshub/commerce-contracts'
import { createPageController } from '../src/rendering/controller.js'
import { createRequestCoalescer } from '../src/cache/request-coalescer.js'
import { reactProductBodyRenderer } from '../src/rendering/product-renderer.js'
import type {
  CacheRead,
  DataEnvelope,
  HtmlEnvelope,
  PageCache,
  ProductBodyRenderer
} from '../src/runtime/interfaces.js'

const catalog: CatalogResponse = {
  countryCode: 'GB',
  language: 'ja-JP',
  currency: 'GBP',
  dataVersion: 7,
  products: [
    {
      id: 'product-01',
      slug: 'field-notebook',
      name: 'フィールドノート',
      description: '丈夫なノート',
      category: 'field',
      imageUrl: '/images/product-01.svg',
      priceMinor: 1299,
      currency: 'GBP',
      inventory: 8,
      availability: 'in-stock',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ]
}

class MemoryPageCache implements PageCache {
  html = new Map<string, HtmlEnvelope>()
  data = new Map<string, DataEnvelope>()
  failReads = false
  failWrites = false
  reads = 0
  writes = 0

  async readHtml(key: string): Promise<CacheRead<HtmlEnvelope>> {
    this.reads += 1
    if (this.failReads) return { status: 'BYPASS' }
    const value = this.html.get(key)
    return value ? { status: 'HIT', value } : { status: 'MISS' }
  }

  async readData(
    key: string,
    _expected: { countryCode: 'US' | 'GB' | 'JP' | 'SG'; language: 'en-US' | 'ja-JP' | 'zh-CN' }
  ): Promise<CacheRead<DataEnvelope>> {
    this.reads += 1
    if (this.failReads) return { status: 'BYPASS' }
    const value = this.data.get(key)
    return value ? { status: 'HIT', value } : { status: 'MISS' }
  }

  async writeHtml(key: string, value: HtmlEnvelope, ttlSeconds: 30) {
    this.writes += 1
    expect(ttlSeconds).toBe(30)
    if (this.failWrites) return false
    this.html.set(key, value)
    return true
  }

  async writeData(key: string, value: DataEnvelope, ttlSeconds: 30) {
    this.writes += 1
    expect(ttlSeconds).toBe(30)
    if (this.failWrites) return false
    this.data.set(key, value)
    return true
  }

  async deleteKeys(keys: readonly string[]) {
    for (const key of keys) {
      this.html.delete(key)
      this.data.delete(key)
    }
    return true
  }
}

function fixture(
  cache = new MemoryPageCache(),
  rendererOverride?: ProductBodyRenderer,
  clockOverride?: { now(): number }
) {
  const getCatalog = vi.fn(async () => {
    await Promise.resolve()
    return catalog
  })
  const renderer: ProductBodyRenderer = rendererOverride ?? {
    render: vi.fn(value => `<section data-version="${value.dataVersion}">products</section>`)
  }
  const assembler = {
    assemble: vi.fn(input =>
      Promise.resolve(
        `<html data-strategy="${input.variant}" data-cache="${input.cacheStatus}">${input.bodyHtml}</html>`
      )
    )
  }
  const logger = { info: vi.fn(), error: vi.fn() }
  const controller = createPageController({
    commerce: { getCatalog, getUser: vi.fn() },
    cache,
    renderer,
    coalescer: createRequestCoalescer(),
    assembler,
    logger,
    clock: clockOverride ?? { now: () => performance.now() }
  })
  const request = {
    countryCode: 'GB' as const,
    language: 'ja-JP' as const,
    requestId: 'request-1'
  }
  return {
    cache,
    getCatalog,
    renderer,
    assembler,
    controller,
    request,
    logger
  }
}

describe('page controller strategy seam', () => {
  it('renders live SSR with one API and one React render while CSR shell does neither', async () => {
    const test = fixture()
    const live = await test.controller.render({ ...test.request, variant: 'live-ssr' })
    expect(live.status).toBe(200)
    expect(live.cacheStatus).toBe('NONE')
    expect(test.getCatalog).toHaveBeenCalledTimes(1)
    expect(test.renderer.render).toHaveBeenCalledTimes(1)

    await test.controller.render({ ...test.request, variant: 'csr' })
    expect(test.getCatalog).toHaveBeenCalledTimes(1)
    expect(test.renderer.render).toHaveBeenCalledTimes(1)
    expect(test.cache.reads).toBe(0)
  })

  it('caches HTML body for 30 seconds and skips API plus SSR on HIT', async () => {
    const test = fixture()
    const first = await test.controller.render({ ...test.request, variant: 'html-cache' })
    const second = await test.controller.render({ ...test.request, variant: 'html-cache' })
    expect(first.cacheStatus).toBe('MISS')
    expect(second.cacheStatus).toBe('HIT')
    expect(test.getCatalog).toHaveBeenCalledTimes(1)
    expect(test.renderer.render).toHaveBeenCalledTimes(1)
  })

  it('caches data for 30 seconds but renders React on every request', async () => {
    const test = fixture()
    const first = await test.controller.render({ ...test.request, variant: 'data-cache' })
    const second = await test.controller.render({ ...test.request, variant: 'data-cache' })
    expect(first.cacheStatus).toBe('MISS')
    expect(second.cacheStatus).toBe('HIT')
    expect(test.getCatalog).toHaveBeenCalledTimes(1)
    expect(test.renderer.render).toHaveBeenCalledTimes(2)
  })

  it('coalesces 20 HTML misses into one API plus SSR and 20 data misses into one API plus 20 SSR', async () => {
    const html = fixture()
    const htmlResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        html.controller.render({ ...html.request, variant: 'html-cache' })
      )
    )
    expect(html.getCatalog).toHaveBeenCalledTimes(1)
    expect(html.renderer.render).toHaveBeenCalledTimes(1)
    expect(
      htmlResults.filter(result => result.coalescing?.role === 'leader')
    ).toHaveLength(1)
    expect(
      htmlResults.filter(result => result.coalescing?.role === 'waiter')
    ).toHaveLength(19)

    const data = fixture()
    const dataResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        data.controller.render({ ...data.request, variant: 'data-cache' })
      )
    )
    expect(data.getCatalog).toHaveBeenCalledTimes(1)
    expect(data.renderer.render).toHaveBeenCalledTimes(20)
    expect(
      dataResults.filter(result => result.coalescing?.role === 'waiter')
    ).toHaveLength(19)
    expect(data.logger.info).not.toHaveBeenCalled()
  })

  it('coalesces concurrent Redis BYPASS reads without writes', async () => {
    const html = fixture()
    html.cache.failReads = true
    const htmlResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        html.controller.render({ ...html.request, variant: 'html-cache' })
      )
    )
    expect(html.getCatalog).toHaveBeenCalledTimes(1)
    expect(html.renderer.render).toHaveBeenCalledTimes(1)
    expect(html.cache.writes).toBe(0)
    expect(htmlResults.every(result => result.cacheStatus === 'BYPASS')).toBe(true)

    const data = fixture()
    data.cache.failReads = true
    const dataResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        data.controller.render({ ...data.request, variant: 'data-cache' })
      )
    )
    expect(data.getCatalog).toHaveBeenCalledTimes(1)
    expect(data.renderer.render).toHaveBeenCalledTimes(20)
    expect(data.cache.writes).toBe(0)
    expect(dataResults.every(result => result.cacheStatus === 'BYPASS')).toBe(true)
  })

  it('clears a rejected leader and returns a uniform 503 on a miss with API failure', async () => {
    const test = fixture()
    test.getCatalog.mockRejectedValueOnce(new Error('offline'))
    const failed = await test.controller.render({ ...test.request, variant: 'html-cache' })
    expect(failed.status).toBe(503)
    const recovered = await test.controller.render({ ...test.request, variant: 'html-cache' })
    expect(recovered.status).toBe(200)
    expect(test.getCatalog).toHaveBeenCalledTimes(2)
  })

  it('records leader and waiter metadata for a coalesced rejection before uniform 503 responses', async () => {
    const test = fixture()
    let reject!: (error: Error) => void
    test.getCatalog.mockReturnValueOnce(
      new Promise((_resolve, rejectWork) => {
        reject = rejectWork
      })
    )
    const leader = test.controller.render({
      ...test.request,
      variant: 'html-cache',
      requestId: 'leader-request'
    })
    await Promise.resolve()
    const waiter = test.controller.render({
      ...test.request,
      variant: 'html-cache',
      requestId: 'waiter-request'
    })
    await Promise.resolve()
    reject(new Error('sensitive upstream detail'))

    const results = await Promise.all([leader, waiter])
    expect(results.map(result => result.status)).toEqual([503, 503])
    expect(results.map(result => result.coalescing?.role).sort()).toEqual([
      'leader',
      'waiter'
    ])
    expect(test.logger.error).not.toHaveBeenCalled()
    expect(JSON.stringify(test.logger.error.mock.calls)).not.toContain(
      'sensitive upstream detail'
    )
  })

  it('serves a valid HTML HIT while the commerce API is offline', async () => {
    const test = fixture()
    await test.controller.render({ ...test.request, variant: 'html-cache' })
    test.getCatalog.mockRejectedValue(new Error('offline'))
    const hit = await test.controller.render({ ...test.request, variant: 'html-cache' })
    expect(hit.status).toBe(200)
    expect(hit.cacheStatus).toBe('HIT')
    expect(test.getCatalog).toHaveBeenCalledTimes(1)
  })

  it('serves a data-cache HIT while commerce is offline', async () => {
    const test = fixture()
    await test.controller.render({ ...test.request, variant: 'data-cache' })
    test.getCatalog.mockRejectedValue(new Error('offline'))
    const hit = await test.controller.render({
      ...test.request,
      variant: 'data-cache'
    })
    expect(hit.status).toBe(200)
    expect(hit.cacheStatus).toBe('HIT')
    expect(test.getCatalog).toHaveBeenCalledTimes(1)
  })

  it('uses the same real React product body for all SSR variants and caches body only', async () => {
    const bodies: string[] = []
    for (const variant of ['html-cache', 'data-cache', 'live-ssr'] as const) {
      const test = fixture(new MemoryPageCache(), reactProductBodyRenderer)
      await test.controller.render({ ...test.request, variant })
      const input = test.assembler.assemble.mock.calls[0]![0]
      bodies.push(input.bodyHtml)
    }
    expect(new Set(bodies)).toHaveLength(1)
    expect(bodies[0]).toContain('data-product-list')

    const html = fixture(new MemoryPageCache(), reactProductBodyRenderer)
    await html.controller.render({ ...html.request, variant: 'html-cache' })
    const envelope = [...html.cache.html.values()][0]!
    expect(envelope.bodyHtml).toContain('data-product-list')
    expect(envelope.bodyHtml).not.toMatch(
      /<!doctype|<html|data-fragment=|<script|Ada Chen|user-ada/i
    )
  })

  it('times rejected API work in finally and returns a sanitized uniform 503 body', async () => {
    let now = 0
    const test = fixture(
      new MemoryPageCache(),
      undefined,
      { now: () => (now += 5) }
    )
    test.getCatalog.mockRejectedValueOnce(
      new Error('token secret at http://private.internal')
    )
    const failed = await test.controller.render({
      ...test.request,
      variant: 'live-ssr'
    })
    expect(failed.status).toBe(503)
    expect(failed.timings.api).toBeGreaterThan(0)
    expect(failed.timings.assemble).toBeGreaterThan(0)
    expect(failed.html).toContain('Service temporarily unavailable')
    expect(failed.html).not.toMatch(/private\.internal|token secret|stack/i)
  })

  it('counts Redis reads and writes in strategy timing', async () => {
    let now = 0
    const test = fixture(
      new MemoryPageCache(),
      undefined,
      { now: () => (now += 5) }
    )
    const result = await test.controller.render({
      ...test.request,
      variant: 'html-cache'
    })
    expect(result.timings.redis).toBeGreaterThanOrEqual(10)
  })

  it('marks Redis read or write failures as BYPASS while returning a live page', async () => {
    const readFailure = new MemoryPageCache()
    readFailure.failReads = true
    const test = fixture(readFailure)
    const result = await test.controller.render({ ...test.request, variant: 'html-cache' })
    expect(result.status).toBe(200)
    expect(result.cacheStatus).toBe('BYPASS')

    const writeFailure = new MemoryPageCache()
    writeFailure.failWrites = true
    const test2 = fixture(writeFailure)
    const result2 = await test2.controller.render({ ...test2.request, variant: 'data-cache' })
    expect(result2.status).toBe(200)
    expect(result2.cacheStatus).toBe('BYPASS')
  })
})
