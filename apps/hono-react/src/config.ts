import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PageConfig {
  hostname: string
  port: number
  artifactRoot: string
  commerceApiUrl: string
  redisUrl: string
  internalToken: string
  sessionSigningSecret: string
  enableDemoEndpoints: boolean
  secureCookies: boolean
}

function hostname(value: string | undefined, name: string): string {
  const candidate = value ?? '127.0.0.1'
  if (
    candidate.length > 253 ||
    candidate.trim() !== candidate ||
    /[\s/?#]/.test(candidate) ||
    candidate.length === 0
  )
    throw new Error(`${name} must be a valid hostname or IP address`)
  return candidate
}

function port(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error('PAGE_SERVER_PORT must be a valid TCP port')
  return parsed
}

const REJECTED_SECRETS = new Set([
  'change-me-for-local-development',
  'replace-with-a-random-secret',
  'replace-with-a-different-random-secret'
])

function secret(value: string | undefined, name: string): string {
  if (!value || value.length < 32 || REJECTED_SECRETS.has(value))
    throw new Error(`${name} must be an independent random secret of at least 32 characters`)
  return value
}

function origin(value: string, name: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error(`${name} must be an http(s) origin without credentials`)
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error(`${name} must not include path, query, or hash`)
  return url.origin
}

function defaultArtifactRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  return basename(moduleDirectory) === 'server' &&
    basename(dirname(moduleDirectory)) === 'dist'
    ? dirname(moduleDirectory)
    : resolve(moduleDirectory, '../dist')
}

export function loadPageConfig(
  environment: NodeJS.ProcessEnv = process.env
): PageConfig {
  const internalToken = secret(
    environment.INTERNAL_SERVICE_TOKEN,
    'INTERNAL_SERVICE_TOKEN'
  )
  const sessionSigningSecret = secret(
    environment.SESSION_SIGNING_SECRET,
    'SESSION_SIGNING_SECRET'
  )
  if (internalToken === sessionSigningSecret)
    throw new Error('INTERNAL_SERVICE_TOKEN and SESSION_SIGNING_SECRET must differ')

  return {
    hostname: hostname(environment.PAGE_SERVER_HOST, 'PAGE_SERVER_HOST'),
    port: port(environment.PAGE_SERVER_PORT, 3000),
    artifactRoot: environment.PAGE_ARTIFACT_ROOT
      ? resolve(environment.PAGE_ARTIFACT_ROOT)
      : defaultArtifactRoot(),
    commerceApiUrl: origin(
      environment.COMMERCE_API_URL ?? 'http://localhost:3001',
      'COMMERCE_API_URL'
    ),
    redisUrl: environment.REDIS_URL ?? 'redis://localhost:6379',
    internalToken,
    sessionSigningSecret,
    enableDemoEndpoints: environment.ENABLE_DEMO_ENDPOINTS === 'true',
    secureCookies: environment.NODE_ENV === 'production'
  }
}
