import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { createInvalidationClient } from '../src/services/invalidation-client.js'

const token = 'test-internal-token-at-least-32-chars'

describe('commerce configuration', () => {
  it('uses a fixed localhost default allowlist', () => {
    expect(loadConfig({ INTERNAL_SERVICE_TOKEN: token })).toMatchObject({
      hostname: '127.0.0.1',
      pageServiceUrl: 'http://localhost:3000',
      pageServiceAllowedOrigins: ['http://localhost:3000']
    })
  })

  it('rejects short tokens, URL credentials, unsafe protocols, and non-allowlisted origins', () => {
    expect(() => loadConfig({ INTERNAL_SERVICE_TOKEN: 'short' })).toThrow(
      /at least 32/i
    )
    expect(() =>
      loadConfig({
        INTERNAL_SERVICE_TOKEN: 'change-me-for-local-development'
      })
    ).toThrow(/random secret/i)
    expect(() =>
      loadConfig({
        INTERNAL_SERVICE_TOKEN: token,
        PAGE_SERVICE_URL: 'http://user:pass@localhost:3000'
      })
    ).toThrow(/credentials/i)
    expect(() =>
      loadConfig({
        INTERNAL_SERVICE_TOKEN: token,
        PAGE_SERVICE_URL: 'file:///tmp/page'
      })
    ).toThrow(/http/i)
    expect(() =>
      loadConfig({
        INTERNAL_SERVICE_TOKEN: token,
        PAGE_SERVICE_URL: 'https://page.example'
      })
    ).toThrow(/allowlist/i)
    expect(() =>
      loadConfig({
        INTERNAL_SERVICE_TOKEN: token,
        PAGE_SERVICE_URL: 'https://page.example',
        PAGE_SERVICE_ALLOWED_ORIGINS: 'https://other.example'
      })
    ).toThrow(/allowlist/i)
  })

  it('accepts an explicit deployment hostname and rejects malformed values', () => {
    expect(
      loadConfig({
        INTERNAL_SERVICE_TOKEN: token,
        COMMERCE_API_HOST: '0.0.0.0'
      }).hostname
    ).toBe('0.0.0.0')
    expect(() =>
      loadConfig({
        INTERNAL_SERVICE_TOKEN: token,
        COMMERCE_API_HOST: 'bad host'
      })
    ).toThrow(/host/i)
  })

  it('accepts a custom page service only when explicitly allowlisted', () => {
    expect(
      loadConfig({
        INTERNAL_SERVICE_TOKEN: token,
        PAGE_SERVICE_URL: 'https://page.example',
        PAGE_SERVICE_ALLOWED_ORIGINS:
          'http://localhost:3000, https://page.example'
      })
    ).toMatchObject({
      pageServiceUrl: 'https://page.example',
      pageServiceAllowedOrigins: [
        'http://localhost:3000',
        'https://page.example'
      ]
    })
  })
})

describe('invalidation webhook adapter', () => {
  it('sends the typed payload and secret header without following redirects', async () => {
    let captured: [URL | RequestInfo, RequestInit | undefined] | undefined
    const fetchAdapter: typeof fetch = async (url, init) => {
      captured = [url, init]
      return Response.json({ accepted: true, deleted: true })
    }
    const client = createInvalidationClient({
      pageServiceUrl: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
      internalToken: token,
      fetchAdapter
    })
    await client({ type: 'price', countryCode: 'GB' })
    expect(captured).toBeDefined()
    const [url, init] = captured!
    expect(String(url)).toBe('http://localhost:3000/internal/cache/invalidate')
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ type: 'price', countryCode: 'GB' })
    })
  })

  it('rejects a successful response that does not confirm deletion', async () => {
    const incomplete = createInvalidationClient({
      pageServiceUrl: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
      internalToken: token,
      fetchAdapter: async () => Response.json({ accepted: true, deleted: false })
    })
    await expect(incomplete({ type: 'reset', scope: 'all' })).rejects.toThrow(
      /confirm deletion/i
    )
  })

  it('rejects non-2xx responses and aborts a timed-out fetch', async () => {
    const failed = createInvalidationClient({
      pageServiceUrl: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
      internalToken: token,
      fetchAdapter: async () => new Response(null, { status: 503 })
    })
    await expect(failed({ type: 'reset', scope: 'all' })).rejects.toThrow(
      /returned 503/i
    )

    const timedOut = createInvalidationClient({
      pageServiceUrl: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
      internalToken: token,
      timeoutMs: 5,
      fetchAdapter: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        })
    })
    await expect(timedOut({ type: 'reset', scope: 'all' })).rejects.toThrow()
  })

  it('fails closed for a non-allowlisted target and treats redirects as errors', async () => {
    expect(() =>
      createInvalidationClient({
        pageServiceUrl: 'https://page.example',
        allowedOrigins: ['http://localhost:3000'],
        internalToken: token
      })
    ).toThrow(/allowlist/i)

    const redirected = createInvalidationClient({
      pageServiceUrl: 'http://localhost:3000',
      allowedOrigins: ['http://localhost:3000'],
      internalToken: token,
      fetchAdapter: async (_url, init) => {
        expect(init?.redirect).toBe('error')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example' }
        })
      }
    })
    await expect(redirected({ type: 'reset', scope: 'all' })).rejects.toThrow(
      /returned 302/i
    )
  })
})
