import { describe, expect, it } from 'vitest'
import { createCommerceClient } from '../src/commerce/client.js'

const token = 'test-internal-token-that-is-long-enough'

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    countryCode: 'GB',
    language: 'ja-JP',
    currency: 'GBP',
    dataVersion: 1,
    products: [],
    ...overrides
  }
}

function clientWith(body: unknown) {
  return createCommerceClient({
    baseUrl: 'http://commerce.test',
    internalToken: token,
    fetchAdapter: async () => Response.json(body)
  })
}

describe('commerce HTTP client response binding', () => {
  it('accepts a catalog only when country, language, and currency match the request', async () => {
    await expect(
      clientWith(catalog()).getCatalog({
        countryCode: 'GB',
        language: 'ja-JP',
        requestId: 'request-1'
      })
    ).resolves.toMatchObject({ countryCode: 'GB', currency: 'GBP' })

    for (const response of [
      catalog({ countryCode: 'US', currency: 'USD' }),
      catalog({ language: 'en-US' }),
      catalog({ currency: 'USD' })
    ]) {
      await expect(
        clientWith(response).getCatalog({
          countryCode: 'GB',
          language: 'ja-JP',
          requestId: 'request-1'
        })
      ).rejects.toMatchObject({ code: 'invalid-response' })
    }
  })

  it('rejects product currencies that disagree with the requested market', async () => {
    const response = catalog({
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
    })
    await expect(
      clientWith(response).getCatalog({
        countryCode: 'GB',
        language: 'ja-JP',
        requestId: 'request-1'
      })
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('binds an internal user response to the requested session user id', async () => {
    const response = {
      user: {
        id: 'user-ren',
        displayName: 'Ren Ito',
        avatar: '/avatars/ren.svg',
        points: 3420,
        membershipTier: 'atelier'
      }
    }
    await expect(
      clientWith(response).getUser({
        userId: 'user-ada',
        requestId: 'request-1'
      })
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })
})
