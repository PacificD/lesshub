'use strict'

const { delimiter, join } = require('node:path')
const { spawnSync } = require('node:child_process')

const shimDirectory = join(__dirname, 'bin')
const executable = process.platform === 'win32' ? 'turbo.cmd' : 'turbo'
const result = spawnSync(executable, process.argv.slice(2), {
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: `${shimDirectory}${delimiter}${process.env.PATH || ''}`
  }
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
