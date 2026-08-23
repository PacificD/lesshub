'use strict'

const major = Number(process.versions.node.split('.')[0])
if (major !== 22) {
  console.error(
    `[runtime] Node 22.x is required for the rendering PoC; received ${process.versions.node}`
  )
  process.exit(1)
}

console.log(`[runtime] node ${process.versions.node}`)
