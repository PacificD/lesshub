const REJECTED_SECRETS = new Set([
  'change-me-for-local-development',
  'replace-with-a-random-secret'
])

export interface CommerceConfig {
  hostname: string
  port: number
  internalToken: string
  pageServiceUrl: string
  pageServiceAllowedOrigins: readonly string[]
}

function validHostname(value: string | undefined): string {
  const candidate = value ?? '127.0.0.1'
  if (
    candidate.length > 253 ||
    candidate.trim() !== candidate ||
    /[\s/?#]/.test(candidate) ||
    candidate.length === 0
  )
    throw new Error('COMMERCE_API_HOST must be a valid hostname or IP address')
  return candidate
}

function validPort(value: string | undefined): number {
  const port = Number(value ?? 3001)
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('COMMERCE_API_PORT must be a valid TCP port')
  return port
}

function normalizedHttpOrigin(value: string, field: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${field} must contain valid URLs`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`${field} must use http or https`)
  if (url.username || url.password)
    throw new Error(`${field} must not contain credentials`)
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error(`${field} must contain origins without path/query/hash`)
  return url.origin
}

export function normalizeAllowedPageServiceOrigins(
  values: readonly string[]
): readonly string[] {
  const origins = [
    ...new Set(
      values.map(value =>
        normalizedHttpOrigin(value, 'PAGE_SERVICE_ALLOWED_ORIGINS')
      )
    )
  ]
  if (origins.length === 0)
    throw new Error('PAGE_SERVICE_ALLOWED_ORIGINS must not be empty')
  return origins
}

export function validatePageServiceUrl(
  value: string,
  allowedOrigins: readonly string[]
): string {
  const origin = normalizedHttpOrigin(value, 'PAGE_SERVICE_URL')
  const normalizedAllowed = normalizeAllowedPageServiceOrigins(allowedOrigins)
  if (!normalizedAllowed.includes(origin))
    throw new Error('PAGE_SERVICE_URL origin is not in the allowlist')
  return origin
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env
): CommerceConfig {
  const internalToken = environment.INTERNAL_SERVICE_TOKEN
  if (
    !internalToken ||
    internalToken.length < 32 ||
    REJECTED_SECRETS.has(internalToken)
  )
    throw new Error('INTERNAL_SERVICE_TOKEN must be a random secret of at least 32 characters')
  const candidateUrl = environment.PAGE_SERVICE_URL ?? 'http://localhost:3000'
  const allowedOrigins = normalizeAllowedPageServiceOrigins(
    (environment.PAGE_SERVICE_ALLOWED_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  )
  return {
    hostname: validHostname(environment.COMMERCE_API_HOST),
    port: validPort(environment.COMMERCE_API_PORT),
    internalToken,
    pageServiceUrl: validatePageServiceUrl(candidateUrl, allowedOrigins),
    pageServiceAllowedOrigins: allowedOrigins
  }
}
