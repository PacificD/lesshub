import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

const repoRoot = resolve(process.cwd(), '../..')
const internalToken = process.env.E2E_INTERNAL_TOKEN
const sessionSecret = process.env.E2E_SESSION_SECRET
if (!internalToken || !sessionSecret)
  throw new Error('The isolated E2E runner must provide E2E_INTERNAL_TOKEN and E2E_SESSION_SECRET')
const pagePort = process.env.E2E_PAGE_PORT ?? '4300'
const commercePort = process.env.E2E_COMMERCE_PORT ?? '4301'
const redisPort = process.env.E2E_REDIS_PORT ?? '6379'
const resultRoot = process.env.E2E_RESULTS_DIR
if (!resultRoot)
  throw new Error('E2E_RESULTS_DIR must identify the current isolated E2E run')
const pageOrigin = `http://127.0.0.1:${pagePort}`
const commerceOrigin = `http://127.0.0.1:${commercePort}`

export default defineConfig({
  forbidOnly: true,
  testDir: './e2e',
  outputDir: resolve(resultRoot, 'artifacts'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [
    ['list'],
    ['junit', { outputFile: resolve(resultRoot, 'junit.xml') }],
    ['json', { outputFile: resolve(resultRoot, 'results.json') }]
  ],
  use: {
    baseURL: pageOrigin,
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'corepack pnpm --filter @lesshub/commerce-api start',
      cwd: repoRoot,
      url: `${commerceOrigin}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        COMMERCE_API_HOST: '127.0.0.1',
        COMMERCE_API_PORT: commercePort,
        INTERNAL_SERVICE_TOKEN: internalToken,
        PAGE_SERVICE_URL: pageOrigin,
        PAGE_SERVICE_ALLOWED_ORIGINS: pageOrigin
      }
    },
    {
      command: 'corepack pnpm --filter @lesshub/hono-react start',
      cwd: repoRoot,
      url: `${pageOrigin}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PAGE_SERVER_HOST: '127.0.0.1',
        PAGE_SERVER_PORT: pagePort,
        COMMERCE_API_URL: commerceOrigin,
        REDIS_URL: `redis://127.0.0.1:${redisPort}`,
        INTERNAL_SERVICE_TOKEN: internalToken,
        SESSION_SIGNING_SECRET: sessionSecret,
        ENABLE_DEMO_ENDPOINTS: 'true'
      }
    }
  ]
})
