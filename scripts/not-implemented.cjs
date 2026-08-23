'use strict'

const command = process.argv[2] || 'command'
const milestone = process.argv[3] || 'a later milestone'
console.error(`[not-implemented] ${command} becomes available in ${milestone}; refusing a false-green run.`)
process.exit(1)
