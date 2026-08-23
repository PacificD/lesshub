import type {
  CatalogResponse,
  CountryCode,
  Language,
  RenderVariant
} from '@lesshub/commerce-contracts'
import { buildCacheKey } from '../cache/cache-key.js'
import { CoalescingError } from '../cache/request-coalescer.js'
import type {
  CacheStatus,
  Clock,
  CommerceClient,
  DocumentAssembler,
  Logger,
  PageCache,
  ProductBodyRenderer,
  RequestCoalescer
} from '../runtime/interfaces.js'

interface ControllerDependencies {
  commerce: CommerceClient
  cache: PageCache
  renderer: ProductBodyRenderer
  coalescer: RequestCoalescer
  assembler: DocumentAssembler
  logger: Logger
  clock: Clock
}

export interface PageRenderRequest {
  countryCode: CountryCode
  language: Language
  variant: RenderVariant
  requestId: string
}

export interface CoalescingObservation {
  role: 'leader' | 'waiter'
  waitMs: number
}

export interface PageRenderResult {
  status: 200 | 503
  html: string
  cacheStatus: CacheStatus
  timings: Record<'redis' | 'api' | 'ssr' | 'assemble', number>
  operations?: {
    redisReads: number
    redisWrites: number
    apiCalls: number
    ssrCalls: number
    assembleCalls: number
  }
  dataVersion?: number
  errorCode?: string
  degradationReason?: 'redis-unavailable' | 'cache-write-failed' | 'commerce-unavailable'
  coalescing?: CoalescingObservation
}

interface CatalogFetch {
  catalog: CatalogResponse
  stored: boolean
}

function elapsed(clock: Clock, started: number): number {
  return Math.max(0, clock.now() - started)
}

export function createPageController(dependencies: ControllerDependencies) {
  async function render(request: PageRenderRequest): Promise<PageRenderResult> {
    const timings = { redis: 0, api: 0, ssr: 0, assemble: 0 }
    const operations = { redisReads: 0, redisWrites: 0, apiCalls: 0, ssrCalls: 0, assembleCalls: 0 }
    let cacheStatus: CacheStatus = 'NONE'
    let dataVersion: number | undefined
    let bodyHtml = ''
    let coalescing: CoalescingObservation | undefined
    let degradationReason: 'redis-unavailable' | 'cache-write-failed' | undefined

    async function measured<T>(
      name: 'redis' | 'api' | 'assemble',
      work: () => Promise<T>
    ): Promise<T> {
      const started = dependencies.clock.now()
      if (name === 'api') operations.apiCalls += 1
      if (name === 'assemble') operations.assembleCalls += 1
      try {
        return await work()
      } finally {
        timings[name] += elapsed(dependencies.clock, started)
      }
    }

    function renderBody(catalog: CatalogResponse): string {
      const started = dependencies.clock.now()
      operations.ssrCalls += 1
      try {
        return dependencies.renderer.render(catalog)
      } finally {
        timings.ssr += elapsed(dependencies.clock, started)
      }
    }

    try {
      if (request.variant === 'csr') {
        const html = await measured('assemble', () =>
          dependencies.assembler.assemble({
            ...request,
            cacheStatus: 'NONE',
            bodyHtml: '',
            csr: true
          })
        )
        const result = {
          status: 200 as const,
          html,
          cacheStatus: 'NONE' as const,
          timings,
          operations
        }
        return result
      }

      const htmlKey = buildCacheKey({
        artifactType: 'page-html',
        countryCode: request.countryCode,
        language: request.language,
        pageKey: 'products-list'
      })
      const dataKey = buildCacheKey({
        artifactType: 'page-data',
        countryCode: request.countryCode,
        language: request.language,
        pageKey: 'products-list'
      })

      if (request.variant === 'html-cache') {
        operations.redisReads += 1
        const cached = await measured('redis', () =>
          dependencies.cache.readHtml(htmlKey)
        )
        cacheStatus = cached.status
        if (cached.status === 'BYPASS') degradationReason = 'redis-unavailable'
        if (cached.status === 'HIT') {
          bodyHtml = cached.value.bodyHtml
          dataVersion = cached.value.dataVersion
        } else {
          const build = async () => {
            const catalog = await measured('api', () =>
              dependencies.commerce.getCatalog(request)
            )
            const html = renderBody(catalog)
            if (cached.status === 'MISS') operations.redisWrites += 1
            const stored =
              cached.status === 'MISS'
                ? await measured('redis', () =>
                    dependencies.cache.writeHtml(
                      htmlKey,
                      {
                        formatVersion: 1,
                        dataVersion: catalog.dataVersion,
                        bodyHtml: html
                      },
                      30
                    )
                  )
                : false
            return { html, dataVersion: catalog.dataVersion, stored }
          }
          if (cached.status === 'MISS' || cached.status === 'BYPASS') {
            const shared = await dependencies.coalescer.run(
              `html:${htmlKey}`,
              build
            )
            coalescing = { role: shared.role, waitMs: shared.waitMs }
            bodyHtml = shared.value.html
            dataVersion = shared.value.dataVersion
            if (cached.status === 'MISS' && !shared.value.stored) {
              cacheStatus = 'BYPASS'
              degradationReason = 'cache-write-failed'
            }
          } else {
            const result = await build()
            bodyHtml = result.html
            dataVersion = result.dataVersion
          }
        }
      } else if (request.variant === 'data-cache') {
        operations.redisReads += 1
        const cached = await measured('redis', () =>
          dependencies.cache.readData(dataKey, {
            countryCode: request.countryCode,
            language: request.language
          })
        )
        cacheStatus = cached.status
        if (cached.status === 'BYPASS') degradationReason = 'redis-unavailable'
        let catalog: CatalogResponse
        if (cached.status === 'HIT') {
          catalog = cached.value.payload
        } else {
          const fetchAndStore = async (): Promise<CatalogFetch> => {
            const value = await measured('api', () =>
              dependencies.commerce.getCatalog(request)
            )
            if (cached.status === 'MISS') operations.redisWrites += 1
            const stored =
              cached.status === 'MISS'
                ? await measured('redis', () =>
                    dependencies.cache.writeData(
                      dataKey,
                      {
                        schemaVersion: 1,
                        dataVersion: value.dataVersion,
                        payload: value
                      },
                      30
                    )
                  )
                : false
            return { catalog: value, stored }
          }
          if (cached.status === 'MISS' || cached.status === 'BYPASS') {
            const shared = await dependencies.coalescer.run(
              `data:${dataKey}`,
              fetchAndStore
            )
            coalescing = { role: shared.role, waitMs: shared.waitMs }
            catalog = shared.value.catalog
            if (cached.status === 'MISS' && !shared.value.stored) {
              cacheStatus = 'BYPASS'
              degradationReason = 'cache-write-failed'
            }
          } else {
            catalog = (await fetchAndStore()).catalog
          }
        }
        dataVersion = catalog.dataVersion
        bodyHtml = renderBody(catalog)
      } else {
        const catalog = await measured('api', () =>
          dependencies.commerce.getCatalog(request)
        )
        dataVersion = catalog.dataVersion
        bodyHtml = renderBody(catalog)
      }

      const html = await measured('assemble', () =>
        dependencies.assembler.assemble({
          ...request,
          cacheStatus,
          ...(dataVersion === undefined ? {} : { dataVersion }),
          bodyHtml,
          csr: false
        })
      )
      return {
        status: 200,
        html,
        cacheStatus,
        timings,
        operations,
        ...(dataVersion === undefined ? {} : { dataVersion }),
        ...(degradationReason ? { degradationReason } : {}),
        ...(coalescing ? { coalescing } : {})
      }
    } catch (error) {
      if (error instanceof CoalescingError)
        coalescing = { role: error.role, waitMs: error.waitMs }
      const errorBody =
        dependencies.renderer.renderError?.() ??
        '<main><h1>Service temporarily unavailable</h1></main>'
      const html = await measured('assemble', () =>
        dependencies.assembler.assemble({
          ...request,
          cacheStatus,
          bodyHtml: errorBody,
          csr: false
        })
      )
      return {
        status: 503,
        html,
        cacheStatus,
        timings,
        operations,
        errorCode: 'catalog-unavailable',
        degradationReason: 'commerce-unavailable',
        ...(coalescing ? { coalescing } : {})
      }
    }
  }

  return { render }
}

export type PageController = ReturnType<typeof createPageController>
