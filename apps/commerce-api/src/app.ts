import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import {
  countryCodeSchema,
  inventoryMutationSchema,
  languageSchema,
  priceMutationSchema,
  productIdSchema,
  translationMutationSchema,
  userIdSchema,
  type CacheInvalidationEvent
} from '@lesshub/commerce-contracts'
import type { CatalogStore } from './domain/catalog-store.js'
import { JsonBodyError, readJsonWithLimit } from './http/read-json.js'

const MAX_JSON_BODY_BYTES = 16_384
const MIN_INTERNAL_TOKEN_LENGTH = 32

export interface CommerceLogger {
  info(message: string): void
  error(message: string): void
}

export interface CommerceAppDependencies {
  store: CatalogStore
  internalToken: string
  notifyInvalidation: (event: CacheInvalidationEvent) => Promise<void>
  logger?: CommerceLogger
}

function errorBody(
  code: string,
  message: string,
  issues?: Array<{ path: string; message: string }>
) {
  return { error: { code, message, ...(issues ? { issues } : {}) } }
}

type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; code: 'body-too-large' | 'invalid-json' }

async function parsedJson(request: Request): Promise<JsonResult> {
  try {
    return {
      ok: true,
      value: await readJsonWithLimit(request, MAX_JSON_BODY_BYTES)
    }
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof JsonBodyError
          ? error.code
          : 'invalid-json'
    }
  }
}

function requestId(header: string | undefined): string {
  return header && /^[A-Za-z0-9._-]{1,64}$/.test(header)
    ? header
    : randomUUID()
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export function createCommerceApp(dependencies: CommerceAppDependencies): Hono {
  if (dependencies.internalToken.length < MIN_INTERNAL_TOKEN_LENGTH)
    throw new Error('internalToken must be at least 32 characters')

  const app = new Hono()
  const logger = dependencies.logger ?? console
  const expectedToken = tokenDigest(dependencies.internalToken)

  app.use('*', async (context, next) => {
    const id = requestId(context.req.header('x-request-id'))
    const started = performance.now()
    context.header('x-request-id', id)
    await next()
    logger.info(
      JSON.stringify({
        event: 'commerce-request',
        requestId: id,
        method: context.req.method,
        route: context.req.routePath || 'unmatched',
        status: context.res.status,
        durationMs: Number((performance.now() - started).toFixed(3))
      })
    )
  })

  const internalAuth = async (
    context: Parameters<Parameters<Hono['use']>[1]>[0],
    next: () => Promise<void>
  ) => {
    const authorization = context.req.header('authorization') ?? ''
    const match = /^Bearer ([^\s]+)$/.exec(authorization)
    const candidate = tokenDigest(match?.[1] ?? '')
    if (!match || !timingSafeEqual(candidate, expectedToken)) {
      return context.json(
        errorBody('unauthorized', 'A valid internal service token is required'),
        401
      )
    }
    await next()
  }

  async function notify(event: CacheInvalidationEvent): Promise<void> {
    try {
      await dependencies.notifyInvalidation(event)
    } catch {
      logger.error(
        JSON.stringify({
          event: 'cache-invalidation-failed',
          invalidationType: event.type
        })
      )
    }
  }

  async function mutationInput(context: Context): Promise<JsonResult> {
    return parsedJson(context.req.raw)
  }

  function malformedJsonResponse(
    context: Context,
    result: Extract<JsonResult, { ok: false }>
  ) {
    return context.json(
      errorBody(
        result.code,
        result.code === 'body-too-large'
          ? 'JSON request body exceeds 16384 bytes'
          : 'Request body must contain valid JSON'
      ),
      400
    )
  }

  app.get('/health', context => context.json({ status: 'ok' }))

  app.get('/v1/catalog', context => {
    const country = countryCodeSchema.safeParse(context.req.query('country'))
    const language = languageSchema.safeParse(context.req.query('language'))
    if (!country.success || !language.success)
      return context.json(
        errorBody('invalid-locale', 'country and language must be supported'),
        400
      )
    return context.json(dependencies.store.catalog(country.data, language.data))
  })

  app.use('/internal/*', internalAuth)

  app.get('/internal/users/:userId', context => {
    const userId = userIdSchema.safeParse(context.req.param('userId'))
    if (!userId.success)
      return context.json(errorBody('invalid-user-id', 'Invalid user id'), 400)
    const user = dependencies.store.user(userId.data)
    if (!user)
      return context.json(errorBody('user-not-found', 'User not found'), 404)
    return context.json({ user })
  })

  app.patch('/internal/products/:productId/price', async context => {
    const productId = productIdSchema.safeParse(context.req.param('productId'))
    if (!productId.success)
      return context.json(errorBody('invalid-product-id', 'Invalid product id'), 400)
    const json = await mutationInput(context)
    if (!json.ok) return malformedJsonResponse(context, json)
    const input = priceMutationSchema.safeParse(json.value)
    if (!input.success)
      return context.json(errorBody('invalid-input', 'Invalid price mutation'), 400)
    try {
      const dataVersion = dependencies.store.setPrice(
        productId.data,
        input.data.countryCode,
        input.data.priceMinor
      )
      await notify({ type: 'price', countryCode: input.data.countryCode })
      return context.json({ productId: productId.data, dataVersion })
    } catch (error) {
      if (error instanceof RangeError)
        return context.json(errorBody('product-not-found', 'Product not found'), 404)
      throw error
    }
  })

  app.patch('/internal/products/:productId/inventory', async context => {
    const productId = productIdSchema.safeParse(context.req.param('productId'))
    if (!productId.success)
      return context.json(errorBody('invalid-product-id', 'Invalid product id'), 400)
    const json = await mutationInput(context)
    if (!json.ok) return malformedJsonResponse(context, json)
    const input = inventoryMutationSchema.safeParse(json.value)
    if (!input.success)
      return context.json(errorBody('invalid-input', 'Invalid inventory mutation'), 400)
    try {
      const dataVersion = dependencies.store.setInventory(
        productId.data,
        input.data.inventory
      )
      await notify({ type: 'inventory', scope: 'all' })
      return context.json({ productId: productId.data, dataVersion })
    } catch (error) {
      if (error instanceof RangeError)
        return context.json(errorBody('product-not-found', 'Product not found'), 404)
      throw error
    }
  })

  app.patch(
    '/internal/products/:productId/translations/:language',
    async context => {
      const productId = productIdSchema.safeParse(context.req.param('productId'))
      const language = languageSchema.safeParse(context.req.param('language'))
      if (!productId.success || !language.success)
        return context.json(
          errorBody('invalid-parameters', 'Invalid product id or language'),
          400
        )
      const json = await mutationInput(context)
      if (!json.ok) return malformedJsonResponse(context, json)
      const input = translationMutationSchema.safeParse(json.value)
      if (!input.success)
        return context.json(
          errorBody('invalid-input', 'Invalid translation mutation'),
          400
        )
      try {
        const dataVersion = dependencies.store.setTranslation(
          productId.data,
          language.data,
          input.data
        )
        await notify({ type: 'translation', language: language.data })
        return context.json({ productId: productId.data, dataVersion })
      } catch (error) {
        if (error instanceof RangeError)
          return context.json(errorBody('product-not-found', 'Product not found'), 404)
        throw error
      }
    }
  )

  app.post('/internal/reset', async context => {
    const dataVersion = dependencies.store.reset()
    await notify({ type: 'reset', scope: 'all' })
    return context.json({ dataVersion })
  })

  app.notFound(context =>
    context.json(errorBody('not-found', 'Route not found'), 404)
  )
  app.onError((_error, context) => {
    logger.error(JSON.stringify({ event: 'commerce-api-error' }))
    return context.json(
      errorBody('internal-error', 'Unexpected commerce service error'),
      500
    )
  })

  return app
}
