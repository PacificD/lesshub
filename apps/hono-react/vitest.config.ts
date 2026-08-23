import { defineConfig } from 'vitest/config'

const root = process.env.LESSHUB_TEST_RESULTS_DIR
const packageRoot = root ? `${root}/packages/hono-react` : undefined

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    reporters: packageRoot ? ['default', 'junit'] : ['default'],
    outputFile: packageRoot ? { junit: `${packageRoot}/junit.xml` } : undefined,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: packageRoot ? `${packageRoot}/coverage` : './coverage'
    }
  }
})
