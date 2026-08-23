import { z } from 'zod'
import {
  catalogResponseSchema,
  currencyForCountry
} from '@lesshub/commerce-contracts'
import type {
  CacheRead,
  DataEnvelope,
  HtmlEnvelope,
  Logger,
  PageCache
} from '../runtime/interfaces.js'

interface RedisCommands {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options: { EX: number }): Promise<unknown>
  del(keys: string | string[]): Promise<number>
}

const htmlEnvelopeSchema = z
  .object({
    formatVersion: z.literal(1),
    dataVersion: z.number().int().positive(),
    bodyHtml: z.string().min(1)
  })
  .strict()
const dataEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    dataVersion: z.number().int().positive(),
    payload: catalogResponseSchema
  })
  .strict()
  .refine(value => value.dataVersion === value.payload.dataVersion, {
    message: 'Envelope and payload data versions must match'
  })

export function createRedisPageCache(
  redis: RedisCommands,
  logger: Logger
): PageCache {
  async function invalid(key: string, kind: string): Promise<void> {
    logger.error({ event: 'invalid-cache-envelope', kind })
    try {
      await redis.del(key)
    } catch {
      logger.error({ event: 'cache-delete-failed', kind })
    }
  }

  async function read<T>(
    key: string,
    schema: z.ZodType<T>,
    kind: string
  ): Promise<CacheRead<T>> {
    let raw: string | null
    try {
      raw = await redis.get(key)
    } catch {
      logger.error({ event: 'cache-read-bypass', kind })
      return { status: 'BYPASS' }
    }
    if (raw === null) return { status: 'MISS' }
    try {
      const result = schema.safeParse(JSON.parse(raw))
      if (!result.success) {
        await invalid(key, kind)
        return { status: 'MISS' }
      }
      return { status: 'HIT', value: result.data }
    } catch {
      await invalid(key, kind)
      return { status: 'MISS' }
    }
  }

  async function write(
    key: string,
    value: HtmlEnvelope | DataEnvelope,
    ttlSeconds: 30,
    kind: string
  ): Promise<boolean> {
    try {
      await redis.set(key, JSON.stringify(value), { EX: ttlSeconds })
      return true
    } catch {
      logger.error({ event: 'cache-write-bypass', kind })
      return false
    }
  }

  return {
    readHtml: key => read(key, htmlEnvelopeSchema, 'page-html'),
    async readData(key, expected) {
      const result = await read(key, dataEnvelopeSchema, 'page-data')
      if (result.status !== 'HIT') return result
      const currency = currencyForCountry(expected.countryCode)
      const payload = result.value.payload
      if (
        payload.countryCode !== expected.countryCode ||
        payload.language !== expected.language ||
        payload.currency !== currency ||
        payload.products.some(product => product.currency !== currency)
      ) {
        await invalid(key, 'page-data-locale')
        return { status: 'MISS' }
      }
      return result
    },
    writeHtml: (key, value, ttl) => write(key, value, ttl, 'page-html'),
    writeData: (key, value, ttl) => write(key, value, ttl, 'page-data'),
    async deleteKeys(keys) {
      if (keys.length === 0) return true
      try {
        await redis.del([...keys])
        return true
      } catch {
        logger.error({ event: 'cache-delete-failed', count: keys.length })
        return false
      }
    }
  }
}
