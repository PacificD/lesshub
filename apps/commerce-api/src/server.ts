import { serve } from '@hono/node-server'
import { createCommerceApp } from './app.js'
import { loadConfig } from './config.js'
import { createCatalogStore } from './domain/catalog-store.js'
import { createInvalidationClient } from './services/invalidation-client.js'

const config = loadConfig()
const app = createCommerceApp({
  store: createCatalogStore(),
  internalToken: config.internalToken,
  notifyInvalidation: createInvalidationClient({
    pageServiceUrl: config.pageServiceUrl,
    allowedOrigins: config.pageServiceAllowedOrigins,
    internalToken: config.internalToken
  })
})

serve(
  { fetch: app.fetch, hostname: config.hostname, port: config.port },
  info => {
    console.log(
      JSON.stringify({
        event: 'commerce-api-started',
        hostname: config.hostname,
        port: info.port
      })
    )
  }
)
