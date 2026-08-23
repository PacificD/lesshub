import {
  catalogResponseSchema,
  currencyForCountry,
  userResponseSchema,
  type CatalogResponse,
  type User
} from '@lesshub/commerce-contracts'
import type { CommerceClient } from '../runtime/interfaces.js'

export class CommerceClientError extends Error {
  constructor(readonly code: 'timeout' | 'unavailable' | 'invalid-response') {
    super(`Commerce request failed: ${code}`)
    this.name = 'CommerceClientError'
  }
}

interface ClientOptions {
  baseUrl: string
  internalToken: string
  timeoutMs?: number
  fetchAdapter?: typeof fetch
}

export function createCommerceClient(options: ClientOptions): CommerceClient {
  const origin = new URL(options.baseUrl).origin
  const fetchAdapter = options.fetchAdapter ?? fetch

  async function request(path: string, requestId: string, internal = false) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000)
    try {
      const response = await fetchAdapter(new URL(path, origin), {
        redirect: 'error',
        headers: {
          'x-request-id': requestId,
          ...(internal
            ? { authorization: `Bearer ${options.internalToken}` }
            : {})
        },
        signal: controller.signal
      })
      if (!response.ok) throw new CommerceClientError('unavailable')
      return await response.json()
    } catch (error) {
      if (error instanceof CommerceClientError) throw error
      if (controller.signal.aborted) throw new CommerceClientError('timeout')
      throw new CommerceClientError('unavailable')
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    async getCatalog(input): Promise<CatalogResponse> {
      const query = new URLSearchParams({
        country: input.countryCode,
        language: input.language
      })
      const parsed = catalogResponseSchema.safeParse(
        await request(`/v1/catalog?${query}`, input.requestId)
      )
      if (!parsed.success) throw new CommerceClientError('invalid-response')
      const currency = currencyForCountry(input.countryCode)
      if (
        parsed.data.countryCode !== input.countryCode ||
        parsed.data.language !== input.language ||
        parsed.data.currency !== currency ||
        parsed.data.products.some(product => product.currency !== currency)
      )
        throw new CommerceClientError('invalid-response')
      return parsed.data
    },
    async getUser(input): Promise<User> {
      const parsed = userResponseSchema.safeParse(
        await request(
          `/internal/users/${encodeURIComponent(input.userId)}`,
          input.requestId,
          true
        )
      )
      if (!parsed.success || parsed.data.user.id !== input.userId)
        throw new CommerceClientError('invalid-response')
      return parsed.data.user
    }
  }
}
