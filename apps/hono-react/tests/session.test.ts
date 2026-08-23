import { describe, expect, it } from 'vitest'
import { createSessionCodec } from '../src/auth/session.js'

const secret = 'test-session-secret-that-is-at-least-32-characters'

describe('signed session seam', () => {
  it('round-trips a valid unexpired session', () => {
    const codec = createSessionCodec(secret, { now: () => 1000 })
    const token = codec.encode({
      version: 1,
      userId: 'user-ada',
      expiresAt: 2000
    })
    expect(codec.decode(token)).toEqual({
      version: 1,
      userId: 'user-ada',
      expiresAt: 2000
    })
  })

  it('rejects tampered, expired, and invalid-user sessions', () => {
    const codec = createSessionCodec(secret, { now: () => 2000 })
    const token = codec.encode({
      version: 1,
      userId: 'user-ada',
      expiresAt: 2000
    })
    expect(codec.decode(`${token}x`)).toBeUndefined()
    expect(codec.decode(token)).toBeUndefined()
    expect(() =>
      codec.encode({ version: 1, userId: '../admin', expiresAt: 3000 })
    ).toThrow(/invalid session/i)
  })
})
