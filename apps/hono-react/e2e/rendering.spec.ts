import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from 'redis'
import { expect, test, type APIResponse, type Page } from '@playwright/test'
import { BENCHMARK_BROWSER_INIT_SCRIPT } from '../benchmark/browser-marks.js'

const countries = ['us', 'gb', 'jp', 'sg'] as const
const languages = ['en-us', 'ja-jp', 'zh-cn'] as const
const variants = ['html-cache', 'data-cache', 'live-ssr', 'csr'] as const
function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`The isolated E2E runner must provide ${name}`)
  return value
}

const resultRoot = requiredEnvironment('E2E_RESULTS_DIR')
const token = requiredEnvironment('E2E_INTERNAL_TOKEN')
const commerceOrigin = `http://127.0.0.1:${requiredEnvironment('E2E_COMMERCE_PORT')}`
const redisUrl = requiredEnvironment('REDIS_URL')

function screenshotPath(name: string): string {
  return resolve(resultRoot, 'screenshots', name)
}

const browserLogWrites: Promise<void>[] = []
function persistBrowserError(message: string) {
  const write = appendFile(
    resolve(resultRoot, 'test.log'),
    `${new Date().toISOString()} ${message}\n`
  )
  browserLogWrites.push(write)
  return write
}

async function expectCache(response: APIResponse, status: 'HIT' | 'MISS') {
  expect(response.status()).toBe(200)
  expect(response.headers()['x-cache']).toBe(status)
  return await response.text()
}

async function observeBrowserErrors(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') {
      const value = `console: ${message.text()}`
      errors.push(value)
      void persistBrowserError(value)
    }
  })
  page.on('pageerror', error => {
    const value = `pageerror: ${error.message}`
    errors.push(value)
    void persistBrowserError(value)
  })
  await page.addInitScript(() => {
    window.addEventListener('lesshub:hydration-error', event => {
      const detail = (event as CustomEvent).detail
      ;(window as unknown as { __lesshubHydrationErrors?: string[] })
        .__lesshubHydrationErrors ??= []
      ;(window as unknown as { __lesshubHydrationErrors: string[] })
        .__lesshubHydrationErrors.push(String(detail))
    })
  })
  return errors
}

async function expectNoBrowserErrors(page: Page, errors: string[]) {
  const hydration = await page.evaluate(
    () =>
      (window as unknown as { __lesshubHydrationErrors?: string[] })
        .__lesshubHydrationErrors ?? []
  )
  if (hydration.length) {
    for (const value of hydration) persistBrowserError(`hydration: ${value}`)
  }
  await Promise.all(browserLogWrites.splice(0))
  expect(errors).toEqual([])
  expect(hydration).toEqual([])
}

test('built servers expose all 48 canonical routes with strategy headers', async ({
  request
}) => {
  for (const country of countries) {
    for (const language of languages) {
      for (const variant of variants) {
        const response = await request.get(
          `/${country}/${language}/benchmark/${variant}/products`
        )
        expect(response.status(), `${country}/${language}/${variant}`).toBe(200)
        expect(response.headers()['x-render-strategy']).toBe(variant)
        expect(response.headers()['content-type']).toContain('text/html')
        expect(response.headers()['server-timing']).toContain('assemble;dur=')
        expect(response.headers()['content-security-policy']).toContain(
          "default-src 'self'"
        )
        expect(response.headers()['content-security-policy']).toContain(
          "object-src 'none'"
        )
        const html = await response.text()
        if (variant === 'csr') expect(html).not.toContain('data-product-list=')
        else expect(html).toContain('data-product-list=')
      }
    }
  }
})

test('healthy strategies expose explicit cache status semantics', async ({ request }) => {
  const headers = { authorization: `Bearer ${token}` }
  expect((await request.post('/internal/cache/reset', { headers })).status()).toBe(200)
  for (const variant of ['html-cache', 'data-cache'] as const) {
    const path = `/gb/en-us/benchmark/${variant}/products`
    expect((await request.get(path)).headers()['x-cache']).toBe('MISS')
    expect((await request.get(path)).headers()['x-cache']).toBe('HIT')
  }
  for (const variant of ['live-ssr', 'csr'] as const) {
    const response = await request.get(`/gb/en-us/benchmark/${variant}/products`)
    expect(response.status()).toBe(200)
    expect(response.headers()['x-cache']).toBe('NONE')
  }
})

test('real Redis covers TTL, prewarm, targeted invalidation, and reset paths', async ({
  request
}) => {
  const redis = createClient({ url: redisUrl })
  await redis.connect()
  const headers = { authorization: `Bearer ${token}` }
  const htmlPath = '/gb/en-us/benchmark/html-cache/products'
  const dataPath = '/gb/en-us/benchmark/data-cache/products'
  const unrelatedPath = '/us/en-us/benchmark/html-cache/products'
  const htmlKey = 'v1:page-html:GB:en-US:products-list'
  const dataKey = 'v1:page-data:GB:en-US:products-list'
  const ttlEvidence: Record<string, number> = {}

  try {
    expect(
      (await request.post('/internal/cache/reset', { headers })).status()
    ).toBe(200)

    await expectCache(await request.get(htmlPath), 'MISS')
    await expectCache(await request.get(htmlPath), 'HIT')
    await expectCache(await request.get(dataPath), 'MISS')
    await expectCache(await request.get(dataPath), 'HIT')
    for (const key of [htmlKey, dataKey]) {
      const ttl = await redis.pTTL(key)
      ttlEvidence[key] = ttl
      expect(ttl, key).toBeGreaterThan(0)
      expect(ttl, key).toBeLessThanOrEqual(30_000)
    }

    expect(
      (await request.post('/internal/cache/reset', { headers })).status()
    ).toBe(200)
    const prewarm = await request.post('/internal/cache/prewarm', { headers })
    expect(prewarm.status()).toBe(200)
    expect(await prewarm.json()).toEqual({ warmed: 24 })
    expect(await redis.dbSize()).toBe(24)
    await expectCache(await request.get(htmlPath), 'HIT')
    await expectCache(await request.get(dataPath), 'HIT')
    await expectCache(await request.get(unrelatedPath), 'HIT')

    const mutation = await request.patch(
      `${commerceOrigin}/internal/products/product-01/price`,
      {
        headers,
        data: { countryCode: 'GB', priceMinor: 9999 }
      }
    )
    expect(mutation.status()).toBe(200)
    expect(await mutation.json()).toMatchObject({ dataVersion: 2 })
    expect(await redis.dbSize()).toBe(18)

    const changedHtml = await expectCache(await request.get(htmlPath), 'MISS')
    expect(changedHtml).toContain('£99.99')
    expect(changedHtml).toContain('<dd>v2</dd>')
    const changedData = await expectCache(await request.get(dataPath), 'MISS')
    expect(changedData).toContain('£99.99')
    expect(changedData).toContain('<dd>v2</dd>')
    await expectCache(await request.get(unrelatedPath), 'HIT')

    await request.post('/internal/cache/prewarm', { headers })
    expect(await redis.dbSize()).toBe(24)
    const invalidateAll = await request.post('/internal/cache/invalidate', {
      headers,
      data: { type: 'inventory', scope: 'all' }
    })
    expect(invalidateAll.status()).toBe(200)
    expect(await redis.dbSize()).toBe(0)

    await request.post('/internal/cache/prewarm', { headers })
    expect(await redis.dbSize()).toBe(24)
    expect(
      (await request.post('/internal/cache/reset', { headers })).status()
    ).toBe(200)
    expect(await redis.dbSize()).toBe(0)

    await request.post('/internal/cache/prewarm', { headers })
    expect(await redis.dbSize()).toBe(24)
    const commerceReset = await request.post(`${commerceOrigin}/internal/reset`, {
      headers
    })
    expect(commerceReset.status()).toBe(200)
    expect(await redis.dbSize()).toBe(0)
    console.log(
      JSON.stringify({
        event: 'redis-e2e-assertions',
        firstRead: 'MISS',
        secondRead: 'HIT',
        ttlMs: ttlEvidence,
        prewarmKeys: 24,
        remainingAfterSixKeyPriceInvalidation: 18,
        batchResetKeys: 0,
        changedPrice: '£99.99',
        changedDataVersion: 2,
        unrelatedCountry: 'HIT'
      })
    )
  } finally {
    await redis.quit()
  }
})

test('benchmark navigation init marks product visibility for SSR and CSR', async ({
  page
}) => {
  await page.addInitScript({ content: BENCHMARK_BROWSER_INIT_SCRIPT })
  for (const variant of ['live-ssr', 'csr'] as const) {
    await page.goto(`/gb/en-us/benchmark/${variant}/products`)
    await expect(page.locator('[data-product-id]')).toHaveCount(20)
    await expect
      .poll(async () =>
        await page.evaluate(() =>
          performance.getEntriesByName('lesshub:products-visible').length
        )
      )
      .toBeGreaterThan(0)
    expect(
      await page.evaluate(() =>
        (window as unknown as { __lesshubBenchmarkInitError?: string | null })
          .__lesshubBenchmarkInitError
      )
    ).toBeNull()
  }
})

test('four strategies converge on identical product DOM without hydration errors', async ({
  browser
}) => {
  const productMarkup: string[] = []
  for (const variant of variants) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = await observeBrowserErrors(page)
    const scripts: string[] = []
    page.on('request', request => {
      if (request.resourceType() === 'script') scripts.push(request.url())
    })
    await page.goto(`/gb/en-us/benchmark/${variant}/products`)
    await expect(page.locator('[data-product-list]')).toBeVisible()
    await expect(page.locator('[data-product-id]')).toHaveCount(20)
    await expect(page.locator('[data-island="user-menu"] .user-menu')).not.toHaveAttribute(
      'data-state',
      'loading'
    )
    expect(scripts.some(value => value.includes('/user-menu-'))).toBe(true)
    productMarkup.push(
      await page.locator('[data-product-list]').evaluate(element => {
        function normalize(node: Node): unknown {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.replace(/\s+/g, ' ').trim()
            return text ? { text } : null
          }
          if (!(node instanceof Element)) return null
          return {
            tag: node.tagName.toLowerCase(),
            attributes: [...node.attributes]
              .map(attribute => [attribute.name, attribute.value] as const)
              .sort(([left], [right]) => left.localeCompare(right)),
            children: [...node.childNodes]
              .map(normalize)
              .filter(value => value !== null)
          }
        }
        return JSON.stringify(normalize(element))
      })
    )
    if (variant === 'csr')
      expect(scripts.some(value => value.includes('/product-list-'))).toBe(true)
    else
      expect(scripts.some(value => value.includes('/product-list-'))).toBe(false)
    if (variant === 'live-ssr') {
      await mkdir(resolve(resultRoot, 'screenshots'), { recursive: true })
      await page.screenshot({
        path: screenshotPath('live-ssr-desktop.png'),
        fullPage: true
      })
    }
    await expectNoBrowserErrors(page, errors)
    await context.close()
  }
  expect(new Set(productMarkup).size).toBe(1)
})

test('user-menu hydrates anonymously and with a signed demo session', async ({
  browser
}) => {
  const anonymousContext = await browser.newContext()
  const anonymous = await anonymousContext.newPage()
  const anonymousErrors = await observeBrowserErrors(anonymous)
  await anonymous.goto('/us/en-us/benchmark/live-ssr/products')
  await expect(anonymous.locator('[data-island="user-menu"] .user-menu')).toHaveAttribute(
    'data-state',
    'anonymous'
  )
  await anonymous.locator('.user-menu__trigger').click()
  await expect(anonymous.locator('.user-menu__panel')).toContainText('Sign in')
  await anonymous.keyboard.press('Escape')
  await expect(anonymous.locator('.user-menu__trigger')).toBeFocused()
  await expectNoBrowserErrors(anonymous, anonymousErrors)
  await anonymousContext.close()

  const memberContext = await browser.newContext()
  const login = await memberContext.request.post('/internal/demo/session', {
    headers: { authorization: `Bearer ${token}` },
    data: { userId: 'user-ada' }
  })
  expect(login.status()).toBe(200)
  const member = await memberContext.newPage()
  const memberErrors = await observeBrowserErrors(member)
  await member.goto('/us/en-us/benchmark/html-cache/products')
  await expect(member.locator('[data-island="user-menu"] .user-menu')).toHaveAttribute(
    'data-state',
    'ready'
  )
  await expect(member.locator('.user-menu__trigger')).toContainText('Ada Chen')
  await member.locator('.user-menu__trigger').click()
  await expect(member.locator('.user-menu__panel')).toContainText('1,280 points')
  await member.keyboard.press('Escape')
  await expect(member.locator('.user-menu__trigger')).toBeFocused()

  const switchUser = await memberContext.request.post('/internal/demo/session', {
    headers: { authorization: `Bearer ${token}` },
    data: { userId: 'user-ren' }
  })
  expect(switchUser.status()).toBe(200)
  await member.reload()
  await expect(member.locator('[data-island="user-menu"] .user-menu')).toHaveAttribute(
    'data-state',
    'ready'
  )
  await expect(member.locator('.user-menu__trigger')).toContainText('Ren Ito')
  await member.locator('.user-menu__trigger').click()
  await expect(member.locator('.user-menu__panel')).toContainText('3,420 points')
  await expectNoBrowserErrors(member, memberErrors)
  await memberContext.close()

  const degradedContext = await browser.newContext()
  const degraded = await degradedContext.newPage()
  await degraded.route('**/api/me', route =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'forced-member-failure' } })
    })
  )
  await degraded.goto('/us/en-us/benchmark/live-ssr/products')
  await expect(degraded.locator('[data-product-id]')).toHaveCount(20)
  await expect(degraded.locator('[data-island="user-menu"] .user-menu')).toHaveAttribute(
    'data-state',
    'unavailable'
  )
  await degradedContext.close()
})

test('CSR retries, keyboard UI works, and the 375px reduced-motion layout does not overflow', async ({
  browser
}) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    reducedMotion: 'reduce'
  })
  const page = await context.newPage()
  const errors = await observeBrowserErrors(page)
  let catalogAttempts = 0
  await page.route('**/api/catalog?**', async route => {
    catalogAttempts += 1
    if (catalogAttempts === 1)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'forced-e2e-failure' } })
      })
    else await route.continue()
  })

  await page.goto('/sg/zh-cn/benchmark/csr/products')
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable')
  await page.getByRole('button', { name: 'Retry catalog' }).click()
  await expect(page.locator('[data-product-id]')).toHaveCount(20)
  expect(catalogAttempts).toBe(2)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const transitionSeconds = await page
    .locator('.user-menu__chevron')
    .evaluate(element => Number.parseFloat(getComputedStyle(element).transitionDuration))
  expect(transitionSeconds).toBeLessThanOrEqual(0.001)

  await expect(page.locator('.user-menu__trigger')).toBeEnabled()
  await page.locator('.user-menu__trigger').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.user-menu__trigger')).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  await page.keyboard.press('Escape')
  await expect(page.locator('.user-menu__trigger')).toBeFocused()

  await mkdir(resolve(resultRoot, 'screenshots'), { recursive: true })
  await page.screenshot({
    path: screenshotPath('csr-375.png'),
    fullPage: true
  })
  await expectNoBrowserErrors(page, errors)
  await context.close()
})
