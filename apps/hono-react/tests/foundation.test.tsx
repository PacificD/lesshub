import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { createPageApp } from '../src/app.js'
import type { PageRuntime } from '../src/artifacts/repository.js'
import { loadPageConfig } from '../src/config.js'
import { buildCacheKey } from '../src/cache/cache-key.js'
import {
  createDocumentShell,
  verifyDocumentSlots
} from '../src/rendering/document-shell.js'

const runtimeArtifacts = {} as PageRuntime

function app() {
  return createPageApp({
    defaultCountry: 'US',
    defaultLanguage: 'en-US',
    runtimeArtifacts,
    controller: {
      render: async () => ({
        status: 200 as const,
        html: '<!doctype html><title>test</title>',
        cacheStatus: 'MISS' as const,
        timings: { redis: 0, api: 0, ssr: 0, assemble: 0 }
      })
    },
    commerce: {
      getCatalog: async () => { throw new Error('not used') },
      getUser: async () => { throw new Error('not used') }
    },
    invalidation: {
      invalidate: async () => true,
      clearAll: async () => true
    },
    sessionCodec: { encode: () => 'session', decode: () => undefined },
    internalToken: 'test-internal-token-that-is-long-enough',
    enableDemoEndpoints: false,
    secureCookies: false,
    logger: { info: () => undefined, error: () => undefined },
    clock: { now: () => 1 }
  })
}

describe('page foundation HTTP seam', () => {
  it('resolves the default artifact root from the app module, not cwd', () => {
    expect(
      loadPageConfig({
        INTERNAL_SERVICE_TOKEN: 'test-internal-token-that-is-long-enough',
        SESSION_SIGNING_SECRET: 'test-session-secret-that-is-long-enough'
      }).artifactRoot
    ).toBe(
      fileURLToPath(new URL('../dist', import.meta.url))
    )
  })

  it('redirects root using valid independent locale cookies', async () => {
    const response = await app().request('/', {
      headers: { cookie: 'lh_country=gb; lh_language=ja-jp' }
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      '/gb/ja-jp/benchmark/html-cache/products'
    )
  })

  it('falls back to the default locale for invalid preference cookies', async () => {
    const response = await app().request('/', {
      headers: { cookie: 'lh_country=xx; lh_language=nope' }
    })
    expect(response.headers.get('location')).toBe(
      '/us/en-us/benchmark/html-cache/products'
    )
  })

  it('canonicalizes only approved product routes and sets locale preferences', async () => {
    const response = await app().request(
      '/GB/ja-JP/benchmark/data-cache/products'
    )
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe(
      '/gb/ja-jp/benchmark/data-cache/products'
    )

    const canonical = await app().request(
      '/gb/ja-jp/benchmark/data-cache/products'
    )
    expect(canonical.status).toBe(200)
    expect(canonical.headers.getSetCookie().join(';')).toContain(
      'lh_country=gb'
    )
  })

  it('returns 404 without cookies for invalid locale, variant, or path', async () => {
    for (const path of [
      '/xx/en-us/benchmark/html-cache/products',
      '/gb/en-us/benchmark/unknown/products',
      '/gb/en-us/benchmark/html-cache/other',
      '/gb/en-us/not-benchmark/html-cache/products'
    ]) {
      const response = await app().request(path)
      expect(response.status, path).toBe(404)
      expect(response.headers.get('set-cookie'), path).toBeNull()
    }
  })
})

describe('cache-key and shell interfaces', () => {
  it('builds canonical keys and rejects semantically invalid combinations', () => {
    expect(
      buildCacheKey({
        artifactType: 'fragment',
        countryCode: 'GB',
        language: 'en-US',
        pageKey: 'navigation'
      })
    ).toBe('v1:fragment:GB:en-US:navigation')

    expect(() =>
      buildCacheKey({
        artifactType: 'fragment',
        countryCode: 'GB',
        language: 'en-US',
        pageKey: 'products-list'
      })
    ).toThrow(/invalid cache key combination/i)
    expect(() =>
      buildCacheKey({
        artifactType: 'page-html',
        countryCode: 'GB',
        language: 'en-US',
        pageKey: 'navigation'
      })
    ).toThrow(/invalid cache key combination/i)
  })

  it('rejects missing, duplicate, and unknown document slots', () => {
    const shell = createDocumentShell()
    expect(() => verifyDocumentSlots(shell)).not.toThrow()
    expect(() =>
      verifyDocumentSlots(shell.replace('<!--slot:footer-->', ''))
    ).toThrow(/exactly one/i)
    expect(() =>
      verifyDocumentSlots(
        shell.replace(
          '<!--slot:footer-->',
          '<!--slot:footer--><!--slot:footer-->'
        )
      )
    ).toThrow(/exactly one/i)
    expect(() =>
      verifyDocumentSlots(
        shell.replace('</body>', '<!--slot:unknown--></body>')
      )
    ).toThrow(/unknown document slot/i)
  })
})
