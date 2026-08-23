import { createHmac, timingSafeEqual } from 'node:crypto'
import { userIdSchema } from '@lesshub/commerce-contracts'
import type { Clock, SessionCodec, SessionPayload } from '../runtime/interfaces.js'

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createSessionCodec(secret: string, clock: Clock): SessionCodec {
  if (secret.length < 32)
    throw new Error('SESSION_SIGNING_SECRET must be at least 32 characters')
  return {
    encode(payload) {
      if (payload.version !== 1 || !userIdSchema.safeParse(payload.userId).success)
        throw new Error('Invalid session payload')
      const serialized = encode(JSON.stringify(payload))
      return `${serialized}.${signature(secret, serialized)}`
    },
    decode(value) {
      const [payload, supplied, extra] = value.split('.')
      if (!payload || !supplied || extra) return undefined
      const expected = signature(secret, payload)
      const suppliedBuffer = Buffer.from(supplied)
      const expectedBuffer = Buffer.from(expected)
      if (
        suppliedBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(suppliedBuffer, expectedBuffer)
      )
        return undefined
      try {
        const parsed = JSON.parse(
          Buffer.from(payload, 'base64url').toString('utf8')
        ) as Partial<SessionPayload>
        if (
          parsed.version !== 1 ||
          !userIdSchema.safeParse(parsed.userId).success ||
          typeof parsed.expiresAt !== 'number' ||
          !Number.isSafeInteger(parsed.expiresAt) ||
          parsed.expiresAt <= clock.now()
        )
          return undefined
        return parsed as SessionPayload
      } catch {
        return undefined
      }
    }
  }
}
