import {
  cacheArtifactTypeSchema,
  countryCodeSchema,
  languageSchema,
  pageKeySchema,
  type CacheArtifactType,
  type CountryCode,
  type Language,
  type PageKey
} from '@lesshub/commerce-contracts'

export interface CacheKeyParts {
  artifactType: CacheArtifactType
  countryCode: CountryCode
  language: Language
  pageKey: PageKey
}

export function buildCacheKey(parts: CacheKeyParts): string {
  const artifactType = cacheArtifactTypeSchema.parse(parts.artifactType)
  const countryCode = countryCodeSchema.parse(parts.countryCode)
  const language = languageSchema.parse(parts.language)
  const pageKey = pageKeySchema.parse(parts.pageKey)
  const valid =
    (artifactType === 'fragment' &&
      (pageKey === 'navigation' || pageKey === 'footer')) ||
    ((artifactType === 'page-html' || artifactType === 'page-data') &&
      pageKey === 'products-list')
  if (!valid)
    throw new Error(
      `Invalid cache key combination: ${artifactType} cannot store ${pageKey}`
    )
  return `v1:${artifactType}:${countryCode}:${language}:${pageKey}`
}
