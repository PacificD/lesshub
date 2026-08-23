import {
  COUNTRIES,
  LANGUAGES,
  cacheInvalidationEventSchema,
  type CacheInvalidationEvent
} from '@lesshub/commerce-contracts'
import { buildCacheKey } from './cache-key.js'
import type {
  InvalidationHandler,
  Logger,
  PageCache
} from '../runtime/interfaces.js'

export function allPageKeys(): string[] {
  return COUNTRIES.flatMap(countryCode =>
    LANGUAGES.flatMap(language =>
      (['page-html', 'page-data'] as const).map(artifactType =>
        buildCacheKey({
          artifactType,
          countryCode,
          language,
          pageKey: 'products-list'
        })
      )
    )
  )
}

export function keysForInvalidation(input: CacheInvalidationEvent): string[] {
  const event = cacheInvalidationEventSchema.parse(input)
  return allPageKeys().filter(key => {
    if (event.type === 'translation') return key.includes(`:${event.language}:`)
    if (event.type === 'price') return key.includes(`:${event.countryCode}:`)
    return true
  })
}

export function createInvalidationHandler(
  cache: PageCache,
  logger: Logger
): InvalidationHandler {
  async function remove(keys: readonly string[]): Promise<boolean> {
    const deleted = await cache.deleteKeys(keys)
    if (!deleted)
      logger.error({ event: 'cache-invalidation-failed', count: keys.length })
    return deleted
  }
  return {
    invalidate: event => remove(keysForInvalidation(event)),
    clearAll: () => remove(allPageKeys()),
    clearTarget: input => remove([
      buildCacheKey({ ...input, pageKey: 'products-list' })
    ])
  }
}
