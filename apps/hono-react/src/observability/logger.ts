import type { Logger } from '../runtime/interfaces.js'

const sensitive =
  /(?:token|secret|password|cookie|session|user[-_]?id|redis[-_]?key|authorization|credential|url|stack)/i

export function sanitizeLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeLogValue)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !sensitive.test(key))
        .map(([key, nested]) => [key, sanitizeLogValue(nested)])
    )
  return value
}

function withTimestamp(fields: Record<string, unknown>) {
  return sanitizeLogValue({
    ...fields,
    timestamp:
      typeof fields.timestamp === 'string'
        ? fields.timestamp
        : new Date().toISOString()
  })
}

export const consoleLogger: Logger = {
  info(fields) {
    console.log(JSON.stringify(withTimestamp(fields)))
  },
  error(fields) {
    console.error(JSON.stringify(withTimestamp(fields)))
  }
}
