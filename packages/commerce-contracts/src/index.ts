import { z } from 'zod'

export const COUNTRIES = ['US', 'GB', 'JP', 'SG'] as const
export const LANGUAGES = ['en-US', 'ja-JP', 'zh-CN'] as const
export const CURRENCIES = ['USD', 'GBP', 'JPY', 'SGD'] as const
export const CACHE_ARTIFACT_TYPES = [
  'fragment',
  'page-html',
  'page-data'
] as const
export const PAGE_KEYS = [
  'navigation',
  'footer',
  'document-shell',
  'products-list'
] as const
export const RENDER_VARIANTS = [
  'html-cache',
  'data-cache',
  'live-ssr',
  'csr'
] as const

export const countryCodeSchema = z.enum(COUNTRIES)
export const languageSchema = z.enum(LANGUAGES)
export const currencySchema = z.enum(CURRENCIES)
export const cacheArtifactTypeSchema = z.enum(CACHE_ARTIFACT_TYPES)
export const pageKeySchema = z.enum(PAGE_KEYS)
export const renderVariantSchema = z.enum(RENDER_VARIANTS)
export const productIdSchema = z.string().regex(/^product-[0-9]{2}$/)
export const userIdSchema = z.string().regex(/^user-[a-z0-9-]{1,48}$/)

export type CountryCode = z.infer<typeof countryCodeSchema>
export type Language = z.infer<typeof languageSchema>
export type Currency = z.infer<typeof currencySchema>
export type CacheArtifactType = z.infer<typeof cacheArtifactTypeSchema>
export type PageKey = z.infer<typeof pageKeySchema>
export type RenderVariant = z.infer<typeof renderVariantSchema>

export const COUNTRY_CURRENCIES: Readonly<Record<CountryCode, Currency>> = {
  US: 'USD',
  GB: 'GBP',
  JP: 'JPY',
  SG: 'SGD'
}

export function currencyForCountry(countryCode: CountryCode): Currency {
  return COUNTRY_CURRENCIES[countryCode]
}

export const availabilitySchema = z.enum([
  'in-stock',
  'low-stock',
  'out-of-stock'
])

export const productSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  imageUrl: z.string().min(1),
  priceMinor: z.number().int().nonnegative(),
  currency: currencySchema,
  inventory: z.number().int().nonnegative(),
  availability: availabilitySchema,
  updatedAt: z.string().datetime()
})

export const catalogResponseSchema = z.object({
  countryCode: countryCodeSchema,
  language: languageSchema,
  currency: currencySchema,
  dataVersion: z.number().int().positive(),
  products: z.array(productSchema)
})

export const membershipTierSchema = z.enum(['field', 'archive', 'atelier'])
export const userSchema = z.object({
  id: userIdSchema,
  displayName: z.string().min(1),
  avatar: z.string().min(1),
  points: z.number().int().nonnegative(),
  membershipTier: membershipTierSchema
})
export const userResponseSchema = z.object({ user: userSchema })

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
  })
})

export const priceMutationSchema = z
  .object({
    countryCode: countryCodeSchema,
    priceMinor: z.number().int().safe().nonnegative().max(100_000_000)
  })
  .strict()
export const inventoryMutationSchema = z
  .object({
    inventory: z.number().int().safe().nonnegative().max(1_000_000)
  })
  .strict()
export const translationMutationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500)
  })
  .strict()

export const cacheInvalidationEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('translation'), language: languageSchema }),
  z.object({ type: z.literal('price'), countryCode: countryCodeSchema }),
  z.object({ type: z.enum(['inventory', 'product']), scope: z.literal('all') }),
  z.object({ type: z.literal('reset'), scope: z.literal('all') })
])

export const mutationResponseSchema = z.object({
  productId: z.string().min(1),
  dataVersion: z.number().int().positive()
})

export const resetResponseSchema = z.object({
  dataVersion: z.number().int().positive()
})

export type Product = z.infer<typeof productSchema>
export type CatalogResponse = z.infer<typeof catalogResponseSchema>
export type User = z.infer<typeof userSchema>
export type UserResponse = z.infer<typeof userResponseSchema>
export type ApiError = z.infer<typeof apiErrorSchema>
export type CacheInvalidationEvent = z.infer<
  typeof cacheInvalidationEventSchema
>
export type PriceMutation = z.infer<typeof priceMutationSchema>
export type InventoryMutation = z.infer<typeof inventoryMutationSchema>
export type TranslationMutation = z.infer<typeof translationMutationSchema>
