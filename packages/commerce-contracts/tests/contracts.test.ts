import { describe, expect, it } from 'vitest'
import {
  CACHE_ARTIFACT_TYPES,
  COUNTRIES,
  LANGUAGES,
  cacheInvalidationEventSchema,
  catalogResponseSchema,
  currencyForCountry,
  userResponseSchema
} from '../src/index.js'

describe('commerce contracts', () => {
  it('defines the approved independent country and language dimensions', () => {
    expect(COUNTRIES).toEqual(['US', 'GB', 'JP', 'SG'])
    expect(LANGUAGES).toEqual(['en-US', 'ja-JP', 'zh-CN'])
    expect(
      COUNTRIES.flatMap(country =>
        LANGUAGES.map(language => `${country}:${language}`)
      )
    ).toHaveLength(12)
  })

  it('maps each country to its currency', () => {
    expect(COUNTRIES.map(currencyForCountry)).toEqual([
      'USD',
      'GBP',
      'JPY',
      'SGD'
    ])
  })

  it('validates catalog and user responses at the HTTP seam', () => {
    const catalog = catalogResponseSchema.parse({
      countryCode: 'GB',
      language: 'ja-JP',
      currency: 'GBP',
      dataVersion: 1,
      products: [
        {
          id: 'product-01',
          slug: 'field-notebook',
          name: 'フィールドノート',
          description: '耐久性のあるノート',
          category: 'desk',
          imageUrl: '/images/product-01.svg',
          priceMinor: 1899,
          currency: 'GBP',
          inventory: 12,
          availability: 'in-stock',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    expect(catalog.currency).toBe('GBP')

    const user = userResponseSchema.parse({
      user: {
        id: 'user-ada',
        displayName: 'Ada Chen',
        avatar: '/avatars/ada.svg',
        points: 1280,
        membershipTier: 'archive'
      }
    })
    expect(user.user.points).toBe(1280)
  })

  it('rejects user identifiers outside the shared user-id contract', () => {
    expect(
      userResponseSchema.safeParse({
        user: {
          id: '../admin',
          displayName: 'Admin',
          avatar: '/avatar.svg',
          points: 0,
          membershipTier: 'field'
        }
      }).success
    ).toBe(false)
  })

  it('rejects invalid invalidation events and exposes cache artifact types', () => {
    expect(
      cacheInvalidationEventSchema.safeParse({
        type: 'price',
        countryCode: 'XX'
      }).success
    ).toBe(false)
    expect(CACHE_ARTIFACT_TYPES).toEqual(['fragment', 'page-html', 'page-data'])
  })
})
