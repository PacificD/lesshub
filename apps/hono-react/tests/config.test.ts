import { describe, expect, it } from 'vitest'
import { loadPageConfig } from '../src/config.js'

const token = 'page-internal-token-1a9d44f481ec4a70'
const session = 'page-session-secret-a854612fcb814e70'

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    INTERNAL_SERVICE_TOKEN: token,
    SESSION_SIGNING_SECRET: session,
    ...overrides
  }
}

describe('page configuration secrets and cookie policy', () => {
  it('accepts two independent random-looking secrets', () => {
    expect(loadPageConfig(environment())).toMatchObject({
      hostname: '127.0.0.1',
      internalToken: token,
      sessionSigningSecret: session,
      secureCookies: false
    })
  })

  it('rejects known placeholders and reused secrets', () => {
    expect(() =>
      loadPageConfig(
        environment({
          INTERNAL_SERVICE_TOKEN: 'change-me-for-local-development'
        })
      )
    ).toThrow(/independent random secret/i)
    expect(() =>
      loadPageConfig(
        environment({
          INTERNAL_SERVICE_TOKEN: token,
          SESSION_SIGNING_SECRET: token
        })
      )
    ).toThrow(/must differ/i)
  })

  it('accepts an explicit deployment hostname and rejects malformed values', () => {
    expect(loadPageConfig(environment({ PAGE_SERVER_HOST: '0.0.0.0' })).hostname).toBe(
      '0.0.0.0'
    )
    expect(() =>
      loadPageConfig(environment({ PAGE_SERVER_HOST: 'bad host' }))
    ).toThrow(/host/i)
  })

  it('enables Secure cookies automatically in production', () => {
    expect(
      loadPageConfig(environment({ NODE_ENV: 'production' })).secureCookies
    ).toBe(true)
  })
})
