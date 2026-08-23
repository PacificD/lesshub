import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { Hono, type Context, type Next } from 'hono'
import { z } from 'zod'
import { getCookie, setCookie } from 'hono/cookie'
import {
  COUNTRIES,
  LANGUAGES,
  cacheInvalidationEventSchema,
  renderVariantSchema,
  userIdSchema,
  type CountryCode,
  type Language
} from '@lesshub/commerce-contracts'
import type { PageRuntime } from './artifacts/repository.js'
import type { PageController } from './rendering/controller.js'
import { readJsonWithLimit } from './http/read-json.js'
import { buildCacheKey } from './cache/cache-key.js'
import { createMetricsRegistry, type MetricsRegistry } from './observability/metrics.js'
import { cacheKeyHash, formatServerTiming, monotonicClock } from './observability/timings.js'
import type {
  Clock,
  CommerceClient,
  InvalidationHandler,
  Logger,
  SessionCodec
} from './runtime/interfaces.js'
import {
  canonicalizeLocalePath,
  countryFromUrl,
  languageFromUrl,
  localeFromPreferences,
  localePath
} from './locale/locale.js'

const benchmarkPath = '/benchmark/html-cache/products'
const MAX_BODY_BYTES = 16_384

type PageEnv = { Variables: { requestId: string; specializedObservation: boolean } }

async function responseBytes(response: Response): Promise<number> {
  const length = response.headers.get('content-length')
  if (length && /^\d+$/.test(length)) return Number(length)
  try {
    return (await response.clone().arrayBuffer()).byteLength
  } catch {
    return 0
  }
}

export interface PageAppDependencies {
  defaultCountry: CountryCode
  defaultLanguage: Language
  runtimeArtifacts: PageRuntime
  controller: PageController
  commerce: CommerceClient
  invalidation: InvalidationHandler
  sessionCodec: SessionCodec
  internalToken: string
  enableDemoEndpoints: boolean
  secureCookies: boolean
  logger: Logger
  clock: Clock
  metrics?: MetricsRegistry
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export function createPageApp(
  dependencies: PageAppDependencies
): Hono<PageEnv> {
  if (dependencies.internalToken.length < 32)
    throw new Error('internalToken must be at least 32 characters')
  const app = new Hono<PageEnv>()
  const metrics = dependencies.metrics ?? createMetricsRegistry()
  const expectedToken = tokenDigest(dependencies.internalToken)

  app.use('*', async (context, next) => {
    const incoming = context.req.header('x-request-id')
    const requestId =
      incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming)
        ? incoming
        : randomUUID()
    context.set('requestId', requestId)
    context.set('specializedObservation', false)
    context.header('x-request-id', requestId)
    context.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
    context.header('x-content-type-options', 'nosniff')
    context.header('referrer-policy', 'strict-origin-when-cross-origin')
    const started = monotonicClock.now()
    await next()
    if (!context.get('specializedObservation')) {
      const totalMs = Math.max(0, monotonicClock.now() - started)
      dependencies.logger.info({
        event: 'request-complete',
        timestamp: new Date().toISOString(),
        requestId,
        method: context.req.method,
        route: new URL(context.req.url).pathname,
        status: context.res.status,
        totalMs,
        responseBytes: await responseBytes(context.res)
      })
    }
  })

  const internalAuth = async (
    context: Context<PageEnv>,
    next: Next
  ) => {
    const match = /^Bearer ([^\s]+)$/.exec(
      context.req.header('authorization') ?? ''
    )
    const candidate = tokenDigest(match?.[1] ?? '')
    if (!match || !timingSafeEqual(candidate, expectedToken))
      return context.json(
        { error: { code: 'unauthorized', message: 'Internal token required' } },
        401
      )
    await next()
  }

  app.get('/health', context =>
    context.json({
      status: 'ok',
      fragments: dependencies.runtimeArtifacts.fragmentCache.size
    })
  )

  app.get('/', context => {
    const locale = localeFromPreferences(
      getCookie(context, 'lh_country'),
      getCookie(context, 'lh_language'),
      {
        countryCode: dependencies.defaultCountry,
        language: dependencies.defaultLanguage
      }
    )
    return context.redirect(`${localePath(locale)}${benchmarkPath}`, 302)
  })

  app.get('/:country/:language/benchmark/:variant/products', async context => {
    const countryCode = countryFromUrl(context.req.param('country'))
    const language = languageFromUrl(context.req.param('language'))
    const variant = renderVariantSchema.safeParse(context.req.param('variant'))
    if (!countryCode || !language || !variant.success) return context.notFound()
    const pathname = new URL(context.req.url).pathname
    const canonicalPath = canonicalizeLocalePath(pathname, {
      countryCode,
      language
    })
    if (canonicalPath !== pathname) return context.redirect(canonicalPath, 308)

    setCookie(context, 'lh_country', countryCode.toLowerCase(), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: dependencies.secureCookies,
      path: '/',
      maxAge: 31_536_000
    })
    setCookie(context, 'lh_language', language.toLowerCase(), {
      httpOnly: true,
      sameSite: 'Lax',
      secure: dependencies.secureCookies,
      path: '/',
      maxAge: 31_536_000
    })

    const started = monotonicClock.now()
    const result = await dependencies.controller.render({
      countryCode,
      language,
      variant: variant.data,
      requestId: context.get('requestId')
    })
    const totalMs = Math.max(0, monotonicClock.now() - started)
    const responseBytes = Buffer.byteLength(result.html)
    const artifactType = variant.data === 'html-cache' ? 'page-html' : variant.data === 'data-cache' ? 'page-data' : undefined
    const key = artifactType ? buildCacheKey({ artifactType, countryCode, language, pageKey: 'products-list' }) : undefined
    const observation = {
      event: 'page-request',
      timestamp: new Date().toISOString(),
      requestId: context.get('requestId'),
      route: '/:country/:language/benchmark/:variant/products',
      status: result.status,
      country: countryCode,
      language,
      pageKey: 'products-list',
      strategy: variant.data,
      cacheStatus: result.cacheStatus,
      ...(key ? { cacheKeyHash: cacheKeyHash(key) } : {}),
      timings: result.timings,
      totalMs,
      responseBytes,
      ...result.operations,
      redisDeletes: 0,
      ...(result.coalescing ? { coalescing: result.coalescing } : {}),
      ...(result.dataVersion === undefined ? {} : { dataVersion: result.dataVersion }),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.degradationReason ? { degradationReason: result.degradationReason } : {})
    }
    dependencies.logger.info(observation)
    context.set('specializedObservation', true)
    metrics.record({
      strategy: variant.data,
      cacheStatus: result.cacheStatus,
      responseBytes,
      ...result.operations,
      ...(result.coalescing ? { coalescingRole: result.coalescing.role } : {}),
      error: result.status >= 500,
      degradation: Boolean(result.degradationReason)
    })
    context.header('content-type', 'text/html; charset=UTF-8')
    context.header('x-render-strategy', variant.data)
    context.header('x-cache', result.cacheStatus)
    context.header('server-timing', formatServerTiming(result.timings, result.coalescing, totalMs))
    return context.body(result.html, result.status)
  })

  app.get('/api/catalog', async context => {
    const countryCode = countryFromUrl(context.req.query('country'))
    const language = languageFromUrl(context.req.query('language'))
    if (!countryCode || !language)
      return context.json(
        { error: { code: 'invalid-locale', message: 'Unsupported locale' } },
        400
      )
    context.header('cache-control', 'no-store')
    const started = monotonicClock.now()
    let status = 200
    try {
      const payload = await dependencies.commerce.getCatalog({
        countryCode,
        language,
        requestId: context.get('requestId')
      })
      const apiMs = Math.max(0, monotonicClock.now() - started)
      const responseBytes = Buffer.byteLength(JSON.stringify(payload))
      context.header('server-timing', formatServerTiming({ api: apiMs }))
      dependencies.logger.info({ event: 'catalog-bff-request', timestamp: new Date().toISOString(), requestId: context.get('requestId'), route: '/api/catalog', status, country: countryCode, language, timings: { api: apiMs }, totalMs: apiMs, responseBytes })
      context.set('specializedObservation', true)
      metrics.record({ strategy: 'csr-catalog-bff', responseBytes, apiCalls: 1 })
      return context.json(payload)
    } catch {
      status = 503
      const apiMs = Math.max(0, monotonicClock.now() - started)
      const body = {
        error: {
          code: 'catalog-unavailable',
          message: 'Catalog temporarily unavailable'
        }
      }
      const responseBytes = Buffer.byteLength(JSON.stringify(body))
      context.header('server-timing', formatServerTiming({ api: apiMs }))
      dependencies.logger.info({ event: 'catalog-bff-request', timestamp: new Date().toISOString(), requestId: context.get('requestId'), route: '/api/catalog', status, country: countryCode, language, timings: { api: apiMs }, totalMs: apiMs, responseBytes, errorCode: 'catalog-unavailable', degradationReason: 'commerce-unavailable' })
      context.set('specializedObservation', true)
      metrics.record({ strategy: 'csr-catalog-bff', responseBytes, apiCalls: 1, error: true, degradation: true })
      return context.json(body, 503)
    }
  })

  app.get('/api/me', async context => {
    context.header('cache-control', 'private, no-store')
    const cookie = getCookie(context, 'lh_session')
    const session = cookie ? dependencies.sessionCodec.decode(cookie) : undefined
    if (!session) return context.json({ user: null })
    try {
      return context.json({
        user: await dependencies.commerce.getUser({
          userId: session.userId,
          requestId: context.get('requestId')
        })
      })
    } catch {
      return context.json(
        {
          error: {
            code: 'member-unavailable',
            message: 'Member data temporarily unavailable'
          }
        },
        503
      )
    }
  })

  app.use('/internal/*', internalAuth)

  app.post('/internal/cache/invalidate', async context => {
    try {
      const event = cacheInvalidationEventSchema.parse(
        await readJsonWithLimit(context.req.raw, MAX_BODY_BYTES)
      )
      const deleted = await dependencies.invalidation.invalidate(event)
      if (!deleted)
        return context.json(
          { accepted: false, deleted: false, error: { code: 'invalidation-failed', message: 'Cache invalidation was not confirmed' } },
          503
        )
      return context.json({ accepted: true, deleted: true })
    } catch {
      return context.json(
        { error: { code: 'invalid-event', message: 'Invalid event payload' } },
        400
      )
    }
  })

  app.post('/internal/cache/reset', async context => {
    const deleted = await dependencies.invalidation.clearAll()
    if (!deleted)
      return context.json(
        { accepted: false, deleted: false, error: { code: 'invalidation-failed', message: 'Cache reset was not confirmed' } },
        503
      )
    return context.json({ accepted: true, deleted: true })
  })

  app.post('/internal/cache/prewarm', async context => {
    const results = []
    for (const countryCode of COUNTRIES) {
      for (const language of LANGUAGES) {
        for (const variant of ['html-cache', 'data-cache'] as const) {
          results.push(
            dependencies.controller.render({
              countryCode,
              language,
              variant,
              requestId: context.get('requestId')
            }).then(() => dependencies.controller.render({
              countryCode,
              language,
              variant,
              requestId: context.get('requestId')
            }))
          )
        }
      }
    }
    const pages = await Promise.all(results)
    const warmed = pages.filter(page => page.status === 200 && page.cacheStatus === 'HIT').length
    if (warmed !== pages.length)
      return context.json({ error: { code: 'prewarm-failed', message: 'All cache targets were not confirmed writable HITs' }, warmed, expected: pages.length }, 503)
    return context.json({ warmed, expected: pages.length })
  })

  const benchmarkTargetSchema = z.object({
    country: z.enum(['us', 'gb', 'jp', 'sg']),
    language: z.enum(['en-us', 'ja-jp', 'zh-cn']),
    artifactType: z.enum(['page-html', 'page-data'])
  }).strict()

  app.post('/internal/benchmark/cache/clear', async context => {
    try {
      const input = benchmarkTargetSchema.parse(await readJsonWithLimit(context.req.raw, MAX_BODY_BYTES))
      const countryCode = countryFromUrl(input.country)!
      const language = languageFromUrl(input.language)!
      const deleted = await dependencies.invalidation.clearTarget?.({ countryCode, language, artifactType: input.artifactType })
      metrics.record({ redisDeletes: deleted ? 1 : 0 })
      if (deleted !== true)
        return context.json({ error: { code: 'cache-clear-failed', message: 'Target cache key was not cleared' }, deleted: false }, 503)
      return context.json({ accepted: true, deleted: true })
    } catch {
      return context.json({ error: { code: 'invalid-target', message: 'Invalid benchmark target' } }, 400)
    }
  })

  app.post('/internal/benchmark/cache/prewarm', async context => {
    try {
      const input = benchmarkTargetSchema.parse(await readJsonWithLimit(context.req.raw, MAX_BODY_BYTES))
      const countryCode = countryFromUrl(input.country)!
      const language = languageFromUrl(input.language)!
      const variant = input.artifactType === 'page-html' ? 'html-cache' : 'data-cache'
      await dependencies.controller.render({ countryCode, language, variant, requestId: context.get('requestId') })
      const confirmed = await dependencies.controller.render({ countryCode, language, variant, requestId: context.get('requestId') })
      if (confirmed.status !== 200 || confirmed.cacheStatus !== 'HIT')
        return context.json({ error: { code: 'prewarm-failed', message: 'Cache HIT not confirmed' } }, 503)
      return context.json({ warmed: true, cacheStatus: confirmed.cacheStatus, dataVersion: confirmed.dataVersion })
    } catch {
      return context.json({ error: { code: 'invalid-target', message: 'Invalid benchmark target' } }, 400)
    }
  })

  app.post('/internal/benchmark/metrics/reset', context => {
    metrics.reset()
    return context.json({ reset: true })
  })
  app.get('/internal/benchmark/metrics/snapshot', context => context.json(metrics.snapshot()))

  app.post('/internal/demo/session', async context => {
    if (!dependencies.enableDemoEndpoints) return context.notFound()
    try {
      const input = (await readJsonWithLimit(
        context.req.raw,
        MAX_BODY_BYTES
      )) as { userId?: unknown }
      const userId = userIdSchema.parse(input.userId)
      const value = dependencies.sessionCodec.encode({
        version: 1,
        userId,
        expiresAt: dependencies.clock.now() + 86_400_000
      })
      setCookie(context, 'lh_session', value, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: dependencies.secureCookies,
        path: '/',
        maxAge: 86_400
      })
      return context.json({ authenticated: true })
    } catch {
      return context.json(
        { error: { code: 'invalid-user', message: 'Invalid demo user' } },
        400
      )
    }
  })

  app.notFound(context =>
    context.json({ error: { code: 'not-found', message: 'Route not found' } }, 404)
  )
  app.onError((_error, context) => {
    dependencies.logger.error({
      event: 'page-app-error',
      requestId: context.get('requestId')
    })
    return context.json(
      { error: { code: 'internal-error', message: 'Unexpected page error' } },
      500
    )
  })
  return app
}
