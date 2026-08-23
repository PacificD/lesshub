'use strict'

const expected = '7.29.1'
const compatible = new Set([expected, '8.6.11'])
const userAgent = process.env.npm_config_user_agent || ''
const match = /^pnpm\/([^\s]+)/.exec(userAgent)
const received = match?.[1] || 'a non-pnpm invocation'

if (!match || !compatible.has(received)) {
  console.error(
    `[toolchain] pnpm ${expected} is the canonical version; received ${received}. ` +
      'Use pnpm 7.29.1 (corepack pnpm) or the supported pnpm 8.6.11 compatibility path.'
  )
  process.exit(1)
}

if (received !== expected) {
  console.warn(
    `[toolchain] pnpm ${received} is supported for local installs; ${expected} remains canonical.`
  )
}

console.log(`[toolchain] pnpm ${received}; node ${process.versions.node}`)
