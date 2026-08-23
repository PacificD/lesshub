import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COUNTRIES, LANGUAGES } from '@lesshub/commerce-contracts'
import { createCommerceApp } from '../src/app.js'
import { createCatalogStore } from '../src/domain/catalog-store.js'

const token = 'test-internal-token-at-least-32-chars'
const internalHeaders = { authorization: `Bearer ${token}` }

function setup() {
  const invalidation = vi.fn(async () => undefined)
  const store = createCatalogStore()
  const logs: string[] = []
  const app = createCommerceApp({
    store,
    internalToken: token,
    notifyInvalidation: invalidation,
    logger: {
      info: value => logs.push(String(value)),
      error: value => logs.push(String(value))
    }
  })
  return { app, store, invalidation, logs }
}

describe('commerce API HTTP seam', () => {
  let fixture = setup()

  beforeEach(() => {
    fixture = setup()
  })

  it('serves 12 independent locale combinations with country currency and language text', async () => {
    for (const country of COUNTRIES) {
      for (const language of LANGUAGES) {
        const response = await fixture.app.request(
          `/v1/catalog?country=${country}&language=${language}`
        )
        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toMatchObject({ countryCode: country, language })
        expect(body.products).toHaveLength(20)
      }
    }
    const gbJapanese = await (
      await fixture.app.request('/v1/catalog?country=GB&language=ja-JP')
    ).json()
    const jpEnglish = await (
      await fixture.app.request('/v1/catalog?country=JP&language=en-US')
    ).json()
    expect(gbJapanese.currency).toBe('GBP')
    expect(gbJapanese.products[0].name).toBe('フィールドノート')
    expect(jpEnglish.currency).toBe('JPY')
    expect(jpEnglish.products[0].name).toBe('Field Notebook')
  })

  it('exposes users only through the protected internal route', async () => {
    expect((await fixture.app.request('/v1/users/user-ada')).status).toBe(404)
    expect((await fixture.app.request('/internal/users/user-ada')).status).toBe(401)
    const response = await fixture.app.request('/internal/users/user-ada', {
      headers: internalHeaders
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      user: { displayName: 'Ada Chen', points: 1280 }
    })
  })

  it('strictly parses bearer authentication', async () => {
    for (const authorization of [
      token,
      `bearer ${token}`,
      `Bearer  ${token}`,
      `Bearer ${token} extra`,
      'Bearer wrong-but-same-length-token-000000'
    ]) {
      const response = await fixture.app.request('/internal/reset', {
        method: 'POST',
        headers: { authorization }
      })
      expect(response.status, authorization).toBe(401)
    }
  })

  it('emits price, inventory, translation, and reset invalidation events', async () => {
    const cases: Array<[string, string, unknown, unknown]> = [
      [
        '/internal/products/product-01/price',
        'PATCH',
        { countryCode: 'GB', priceMinor: 2500 },
        { type: 'price', countryCode: 'GB' }
      ],
      [
        '/internal/products/product-01/inventory',
        'PATCH',
        { inventory: 0 },
        { type: 'inventory', scope: 'all' }
      ],
      [
        '/internal/products/product-02/translations/zh-CN',
        'PATCH',
        { name: '精密黄铜尺', description: '适合制图桌的精密测量工具。' },
        { type: 'translation', language: 'zh-CN' }
      ]
    ]
    for (const [path, method, body, event] of cases) {
      const response = await fixture.app.request(path, {
        method,
        headers: { ...internalHeaders, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      expect(response.status).toBe(200)
      expect(fixture.invalidation).toHaveBeenLastCalledWith(event)
    }
    const reset = await fixture.app.request('/internal/reset', {
      method: 'POST',
      headers: internalHeaders
    })
    expect(reset.status).toBe(200)
    expect(fixture.invalidation).toHaveBeenLastCalledWith({
      type: 'reset',
      scope: 'all'
    })
  })

  it('returns stable 4xx errors for invalid params, unsafe values, malformed and oversized bodies', async () => {
    const cases: Array<[string, RequestInit]> = [
      [
        '/internal/products/INVALID!/inventory',
        {
          method: 'PATCH',
          headers: { ...internalHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ inventory: 1 })
        }
      ],
      [
        '/internal/products/product-01/inventory',
        {
          method: 'PATCH',
          headers: { ...internalHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ inventory: Number.MAX_SAFE_INTEGER + 1 })
        }
      ],
      [
        '/internal/products/product-01/price',
        {
          method: 'PATCH',
          headers: { ...internalHeaders, 'content-type': 'application/json' },
          body: '{'
        }
      ],
      [
        '/internal/products/product-01/translations/en-US',
        {
          method: 'PATCH',
          headers: { ...internalHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x'.repeat(121), description: 'valid' })
        }
      ],
      [
        '/internal/products/product-01/inventory',
        {
          method: 'PATCH',
          headers: {
            ...internalHeaders,
            'content-type': 'application/json',
            'content-length': '20000'
          },
          body: JSON.stringify({ inventory: 1 })
        }
      ]
    ]
    for (const [path, init] of cases) {
      const response = await fixture.app.request(path, init)
      expect(response.status, path).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: expect.any(String), message: expect.any(String) }
      })
    }
  })

  it('cancels a chunked mutation body as soon as it crosses 16KiB', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(17_000)))
      },
      cancel() {
        cancelled = true
      }
    })
    const request = new Request(
      'http://localhost/internal/products/product-01/inventory',
      {
        method: 'PATCH',
        headers: internalHeaders,
        body: stream,
        duplex: 'half'
      } as RequestInit & { duplex: 'half' }
    )
    const response = await fixture.app.fetch(request)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'body-too-large' }
    })
    expect(cancelled).toBe(true)
  })

  it('keeps successful mutations when invalidation delivery fails without logging upstream details', async () => {
    fixture.invalidation.mockRejectedValueOnce(
      new Error('page service unavailable at http://secret.internal')
    )
    const response = await fixture.app.request(
      '/internal/products/product-01/inventory',
      {
        method: 'PATCH',
        headers: { ...internalHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ inventory: 0 })
      }
    )
    expect(response.status).toBe(200)
    const joined = fixture.logs.join('\n')
    expect(joined).toContain('cache-invalidation-failed')
    expect(joined).not.toContain('secret.internal')
  })

  it('writes sanitized structured request logs for success and 4xx responses', async () => {
    await fixture.app.request('/v1/catalog?country=GB&language=en-US', {
      headers: { 'x-request-id': 'request-123' }
    })
    await fixture.app.request('/internal/users/user-ada', {
      headers: { authorization: 'Bearer definitely-secret-token-value' }
    })
    const entries = fixture.logs.map(line => JSON.parse(line))
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'commerce-request',
          requestId: 'request-123',
          method: 'GET',
          status: 200,
          route: '/v1/catalog'
        }),
        expect.objectContaining({
          event: 'commerce-request',
          route: '/internal/*',
          status: 401
        })
      ])
    )
    expect(fixture.logs.join('\n')).not.toContain('user-ada')
    expect(fixture.logs.join('\n')).not.toContain('definitely-secret')
  })

  it('logs a sanitized 500 without leaking the thrown error', async () => {
    const logs: string[] = []
    const store = createCatalogStore()
    const broken = createCommerceApp({
      store: {
        ...store,
        catalog() {
          throw new Error('database password is hunter2')
        }
      },
      internalToken: token,
      notifyInvalidation: async () => undefined,
      logger: {
        info: value => logs.push(String(value)),
        error: value => logs.push(String(value))
      }
    })
    const response = await broken.request(
      '/v1/catalog?country=US&language=en-US'
    )
    expect(response.status).toBe(500)
    expect(logs.join('\n')).toContain('commerce-api-error')
    expect(logs.join('\n')).toContain('"status":500')
    expect(logs.join('\n')).not.toContain('hunter2')
  })
})
