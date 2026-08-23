import {
  cacheInvalidationEventSchema,
  type CacheInvalidationEvent
} from '@lesshub/commerce-contracts'
import { validatePageServiceUrl } from '../config.js'

export interface InvalidationClientOptions {
  pageServiceUrl: string
  allowedOrigins: readonly string[]
  internalToken: string
  timeoutMs?: number
  fetchAdapter?: typeof fetch
}

export function createInvalidationClient(
  options: InvalidationClientOptions
): (event: CacheInvalidationEvent) => Promise<void> {
  if (options.internalToken.length < 32)
    throw new Error('internalToken must be at least 32 characters')
  const pageServiceUrl = validatePageServiceUrl(
    options.pageServiceUrl,
    options.allowedOrigins
  )
  const fetchAdapter = options.fetchAdapter ?? fetch

  return async event => {
    const payload = cacheInvalidationEventSchema.parse(event)
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 2_000
    )
    try {
      const response = await fetchAdapter(
        new URL('/internal/cache/invalidate', pageServiceUrl),
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${options.internalToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      )
      if (!response.ok)
        throw new Error(`Invalidation webhook returned ${response.status}`)
      const body = await response.json().catch(() => undefined)
      if (
        !body ||
        body.accepted !== true ||
        body.deleted !== true
      )
        throw new Error('Invalidation webhook did not confirm deletion')
    } finally {
      clearTimeout(timeout)
    }
  }
}
