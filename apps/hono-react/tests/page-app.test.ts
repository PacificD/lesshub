import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageRuntime } from '../src/artifacts/repository.js'
import { createPageApp } from '../src/app.js'
import { createSessionCodec } from '../src/auth/session.js'
import type { PageRenderResult } from '../src/rendering/controller.js'
import type { CacheStatus } from '../src/runtime/interfaces.js'

const token = 'test-internal-token-that-is-long-enough'
const catalog = {
  countryCode: 'GB' as const,
  language: 'ja-JP' as const,
  currency: 'GBP' as const,
  dataVersion: 1,
  products: []
}

function fixture(options: { demo?: boolean; secure?: boolean } = {}) {
  const getCatalog = vi.fn(async () => catalog)
  const getUser = vi.fn(async () => ({
    id: 'user-ada',
    displayName: 'Ada Chen',
    avatar: '/avatars/ada.svg',
    points: 1280,
    membershipTier: 'archive' as const
  }))
  const render = vi.fn(async (): Promise<PageRenderResult> => ({
    status: 200,
    html: '<!doctype html><main>products</main>',
    cacheStatus: 'NONE' as CacheStatus,
    timings: { redis: 0, api: 1, ssr: 1, assemble: 1 }
  }))
  const controller = { render }
  const invalidation = {
    invalidate: vi.fn(async () => true),
    clearAll: vi.fn(async () => true),
    clearTarget: vi.fn(async () => true)
  }
  const clock = { now: () => 1000 }
  const logger = { info: vi.fn(), error: vi.fn() }
  const app = createPageApp({
    defaultCountry: 'US',
    defaultLanguage: 'en-US',
    runtimeArtifacts: {
      fragmentCache: { size: 24 }
    } as PageRuntime,
    controller,
    commerce: { getCatalog, getUser },
    invalidation,
    sessionCodec: createSessionCodec(
      'test-session-secret-that-is-long-enough',
      clock
    ),
    internalToken: token,
    enableDemoEndpoints: options.demo ?? false,
    secureCookies: options.secure ?? false,
    logger,
    clock
  })
  return { app, controller, getCatalog, getUser, invalidation, logger }
}

describe('page BFF and internal HTTP seams', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('covers the canonical 12-locale by 4-strategy route matrix', async () => {
    const test = fixture()
    const countries = ['us', 'gb', 'jp', 'sg']
    const languages = ['en-us', 'ja-jp', 'zh-cn']
    const variants = ['html-cache', 'data-cache', 'live-ssr', 'csr']
    for (const country of countries)
      for (const language of languages)
        for (const variant of variants) {
          const response = await test.app.request(
            `/${country}/${language}/benchmark/${variant}/products`
          )
          expect(response.status, `${country}/${language}/${variant}`).toBe(200)
          expect(response.headers.get('x-render-strategy')).toBe(variant)
          expect(response.headers.get('x-cache')).toBe('NONE')
        }
    expect(test.controller.render).toHaveBeenCalledTimes(48)
  })

  it('proxies every CSR catalog request live and marks it no-store', async () => {
    const test = fixture()
    for (let index = 0; index < 2; index += 1) {
      const response = await test.app.request(
        '/api/catalog?country=gb&language=ja-jp'
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(test.getCatalog).toHaveBeenCalledTimes(2)
    expect(test.controller.render).not.toHaveBeenCalled()
  })

  it('logs catalog failures with actual UTF-8 bytes and a degradation reason', async () => {
    const test = fixture()
    test.getCatalog.mockRejectedValueOnce(new Error('offline'))
    const response = await test.app.request('/api/catalog?country=gb&language=ja-jp')
    const body = await response.text()
    expect(response.status).toBe(503)
    const observation = test.logger.info.mock.calls.find(
      ([fields]) => fields.event === 'catalog-bff-request'
    )?.[0]
    expect(observation).toMatchObject({
      status: 503,
      responseBytes: Buffer.byteLength(body),
      degradationReason: 'commerce-unavailable'
    })
  })

  it('returns anonymous /api/me without calling commerce and private no-store', async () => {
    const test = fixture()
    const response = await test.app.request('/api/me')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ user: null })
    expect(test.getUser).not.toHaveBeenCalled()
  })

  it('gates demo sessions by feature flag and token, then resolves authenticated /api/me', async () => {
    const disabled = fixture()
    expect(
      (
        await disabled.app.request('/internal/demo/session', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ userId: 'user-ada' })
        })
      ).status
    ).toBe(404)

    const test = fixture({ demo: true })
    const unauthorized = await test.app.request('/internal/demo/session', {
      method: 'POST'
    })
    expect(unauthorized.status).toBe(401)
    const login = await test.app.request('/internal/demo/session', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ userId: 'user-ada' })
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.getSetCookie()[0]?.split(';')[0]
    expect(cookie).toContain('lh_session=')
    expect(login.headers.getSetCookie()[0]).toContain('HttpOnly')
    expect(login.headers.getSetCookie()[0]).toContain('SameSite=Lax')

    const me = await test.app.request('/api/me', {
      headers: { cookie: cookie ?? '' }
    })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ user: { points: 1280 } })
    expect(test.getUser).toHaveBeenCalledTimes(1)
    expect(test.controller.render).not.toHaveBeenCalled()
  })

  it('protects typed targeted cache and metrics benchmark controls', async () => {
    const test = fixture()
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const invalid = await test.app.request('/internal/benchmark/cache/clear', { method: 'POST', headers, body: JSON.stringify({ key: 'v1:secret' }) })
    expect(invalid.status).toBe(400)
    const cleared = await test.app.request('/internal/benchmark/cache/clear', { method: 'POST', headers, body: JSON.stringify({ country: 'gb', language: 'ja-jp', artifactType: 'page-html' }) })
    expect(cleared.status).toBe(200)
    expect(await cleared.json()).toMatchObject({ deleted: true })
    expect(test.invalidation.clearTarget).toHaveBeenCalledWith({ countryCode: 'GB', language: 'ja-JP', artifactType: 'page-html' })
    test.invalidation.clearTarget.mockResolvedValueOnce(false)
    const failed = await test.app.request('/internal/benchmark/cache/clear', { method: 'POST', headers, body: JSON.stringify({ country: 'gb', language: 'ja-jp', artifactType: 'page-html' }) })
    expect(failed.status).toBe(503)
    expect((await test.app.request('/internal/benchmark/metrics/snapshot')).status).toBe(401)
    expect((await test.app.request('/internal/benchmark/metrics/snapshot', { headers })).status).toBe(200)
  })

  it('only reports prewarm after every target is confirmed as a writable HIT', async () => {
    const test = fixture()
    test.controller.render.mockResolvedValue({
      status: 200,
      html: '<main />',
      cacheStatus: 'HIT',
      timings: { redis: 1, api: 0, ssr: 0, assemble: 1 }
    })
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const warmed = await test.app.request('/internal/cache/prewarm', { method: 'POST', headers })
    expect(warmed.status).toBe(200)
    expect(await warmed.json()).toEqual({ warmed: 24, expected: 24 })
    expect(test.controller.render).toHaveBeenCalledTimes(48)

    test.controller.render.mockResolvedValue({
      status: 200,
      html: '<main />',
      cacheStatus: 'BYPASS',
      timings: { redis: 1, api: 1, ssr: 1, assemble: 1 }
    })
    const failed = await test.app.request('/internal/cache/prewarm', { method: 'POST', headers })
    expect(failed.status).toBe(503)
    expect(await failed.json()).toMatchObject({ warmed: 0, expected: 24, error: { code: 'prewarm-failed' } })
  })

  it('logs generic request completion exactly once for non-specialized routes', async () => {
    const test = fixture()
    await test.app.request('/health')
    await test.app.request('/api/me')
    await test.app.request('/missing')
    const generic = test.logger.info.mock.calls
      .map(([fields]) => fields)
      .filter(fields => fields.event === 'request-complete')
    expect(generic).toHaveLength(3)
    expect(generic.map(fields => fields.status)).toEqual([200, 200, 404])
    expect(generic.every(fields => typeof fields.responseBytes === 'number')).toBe(true)
  })

  it('logs exactly one generic 500 observation when the page controller rejects', async () => {
    const test = fixture()
    test.controller.render.mockRejectedValueOnce(new Error('controller failed'))
    const response = await test.app.request('/gb/ja-jp/benchmark/live-ssr/products')
    const body = await response.text()
    expect(response.status).toBe(500)
    const generic = test.logger.info.mock.calls
      .map(([fields]) => fields)
      .filter(fields => fields.event === 'request-complete')
    expect(generic).toHaveLength(1)
    expect(generic[0]).toMatchObject({
      status: 500,
      route: '/gb/ja-jp/benchmark/live-ssr/products',
      responseBytes: Buffer.byteLength(body)
    })
    expect(test.logger.info.mock.calls.some(([fields]) => fields.event === 'page-request')).toBe(false)
  })

  it('emits one redacted typed page observation with counts and degradation', async () => {
    const test = fixture()
    test.controller.render.mockResolvedValueOnce({
      status: 200,
      html: '<!doctype html><main>products</main>',
      cacheStatus: 'BYPASS',
      timings: { redis: 1, api: 2, ssr: 3, assemble: 4 },
      operations: { redisReads: 1, redisWrites: 0, apiCalls: 1, ssrCalls: 1, assembleCalls: 1 },
      dataVersion: 2,
      degradationReason: 'redis-unavailable'
    })
    await test.app.request('/gb/ja-jp/benchmark/html-cache/products', { headers: { cookie: 'secret', authorization: 'secret' } })
    const observations = test.logger.info.mock.calls.filter(([fields]) => fields.event === 'page-request')
    expect(observations).toHaveLength(1)
    expect(observations[0]?.[0]).toMatchObject({ strategy: 'html-cache', cacheStatus: 'BYPASS', redisReads: 1, apiCalls: 1, degradationReason: 'redis-unavailable', dataVersion: 2 })
    expect(JSON.stringify(observations)).not.toContain('secret')
    expect(JSON.stringify(observations)).not.toContain('v1:page-html')
  })

  it('reports coalescing role and wait time in Server-Timing', async () => {
    const test = fixture()
    test.controller.render.mockResolvedValueOnce({
      status: 200,
      html: '<!doctype html><main>products</main>',
      cacheStatus: 'MISS',
      timings: { redis: 1, api: 2, ssr: 3, assemble: 4 },
      coalescing: { role: 'waiter', waitMs: 5 }
    } satisfies PageRenderResult)
    const response = await test.app.request(
      '/gb/ja-jp/benchmark/html-cache/products'
    )
    expect(response.headers.get('server-timing')).toContain(
      'coalesce;dur=5.00;desc="waiter"'
    )
  })

  it('sets strict CSP headers on HTML and Secure on production demo cookies', async () => {
    const test = fixture({ demo: true, secure: true })
    const page = await test.app.request(
      '/gb/ja-jp/benchmark/live-ssr/products'
    )
    expect(page.headers.get('content-security-policy')).toContain(
      "default-src 'self'"
    )
    expect(page.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'"
    )
    const login = await test.app.request('/internal/demo/session', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ userId: 'user-ada' })
    })
    expect(login.headers.getSetCookie()[0]).toContain('Secure')
  })

  it('cancels an unbounded stream after the JSON body crosses 16KiB', async () => {
    const test = fixture()
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(17_000)))
      },
      cancel() {
        cancelled = true
      }
    })
    const request = new Request('http://localhost/internal/cache/invalidate', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: stream,
      duplex: 'half'
    } as RequestInit & { duplex: 'half' })
    const response = await test.app.fetch(request)
    expect(response.status).toBe(400)
    expect(cancelled).toBe(true)
  })

  it('validates invalidation auth and event payloads', async () => {
    const test = fixture()
    expect(
      (
        await test.app.request('/internal/cache/invalidate', {
          method: 'POST',
          body: JSON.stringify({ type: 'reset', scope: 'all' })
        })
      ).status
    ).toBe(401)
    expect(
      (
        await test.app.request('/internal/cache/invalidate', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ type: 'price', countryCode: 'XX' })
        })
      ).status
    ).toBe(400)

    const valid = await test.app.request('/internal/cache/invalidate', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ type: 'translation', language: 'ja-JP' })
    })
    expect(valid.status).toBe(200)
    expect(await valid.json()).toEqual({ accepted: true, deleted: true })
    expect(test.invalidation.invalidate).toHaveBeenCalledWith({
      type: 'translation',
      language: 'ja-JP'
    })

    test.invalidation.invalidate.mockResolvedValueOnce(false)
    const failed = await test.app.request('/internal/cache/invalidate', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ type: 'translation', language: 'ja-JP' })
    })
    expect(failed.status).toBe(503)
    expect(await failed.json()).toMatchObject({ accepted: false, deleted: false })
  })
})
