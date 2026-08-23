import { join } from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createClient } from 'redis'
import { createPageApp } from './app.js'
import { preparePageRuntime } from './artifacts/repository.js'
import { createSessionCodec } from './auth/session.js'
import { createInvalidationHandler } from './cache/invalidation.js'
import { createRedisPageCache } from './cache/redis-page-cache.js'
import { createRequestCoalescer } from './cache/request-coalescer.js'
import { createCommerceClient } from './commerce/client.js'
import { loadPageConfig } from './config.js'
import { consoleLogger } from './observability/logger.js'
import { createMetricsRegistry } from './observability/metrics.js'
import { monotonicClock } from './observability/timings.js'
import { createPageController } from './rendering/controller.js'
import { createDocumentAssembler } from './rendering/document-assembler.js'
import { reactProductBodyRenderer } from './rendering/product-renderer.js'

const config = loadPageConfig()
const runtimeArtifacts = await preparePageRuntime(config.artifactRoot)
const redis = createClient({
  url: config.redisUrl,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 1000,
    reconnectStrategy: retries => Math.min(250 * 2 ** Math.min(retries, 3), 2000)
  }
})
redis.on('error', () =>
  consoleLogger.error({ event: 'redis-client-error' })
)
void redis.connect().catch(() =>
  consoleLogger.error({ event: 'redis-connect-bypass' })
)
const cache = createRedisPageCache(redis, consoleLogger)
const commerce = createCommerceClient({
  baseUrl: config.commerceApiUrl,
  internalToken: config.internalToken
})
const wallClock = { now: () => Date.now() }
const metrics = createMetricsRegistry()
const controller = createPageController({
  commerce,
  cache,
  renderer: reactProductBodyRenderer,
  coalescer: createRequestCoalescer({ now: monotonicClock.now }),
  assembler: createDocumentAssembler(runtimeArtifacts),
  logger: consoleLogger,
  clock: monotonicClock
})
const pageApp = createPageApp({
  defaultCountry: 'US',
  defaultLanguage: 'en-US',
  runtimeArtifacts,
  controller,
  commerce,
  invalidation: createInvalidationHandler(cache, consoleLogger),
  sessionCodec: createSessionCodec(config.sessionSigningSecret, wallClock),
  internalToken: config.internalToken,
  enableDemoEndpoints: config.enableDemoEndpoints,
  secureCookies: config.secureCookies,
  logger: consoleLogger,
  clock: wallClock,
  metrics
})
const app = new Hono()
const clientRoot = join(config.artifactRoot, 'client')
app.use('/assets/*', async (context, next) => {
  await next()
  if (context.res.status === 200)
    context.header('cache-control', 'public, max-age=31536000, immutable')
})
app.use('/assets/*', serveStatic({ root: clientRoot }))
app.use('/images/*', serveStatic({ root: clientRoot }))
app.use('/favicon.svg', serveStatic({ root: clientRoot }))
app.route('/', pageApp)

serve(
  { fetch: app.fetch, hostname: config.hostname, port: config.port },
  info => {
  consoleLogger.info({
    event: 'page-service-started',
    port: info.port,
    fragments: runtimeArtifacts.fragmentCache.size,
      hostname: config.hostname,
      redis: redis.isReady ? 'ready' : 'bypass'
    })
  }
)
