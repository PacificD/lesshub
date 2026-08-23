import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArtifactRepository } from '../src/artifacts/repository.js'

export interface ArtifactVerification {
  fragmentCount: number
  templateCount: number
}

async function requireFile(path: string): Promise<void> {
  const details = await stat(path)
  if (!details.isFile() || details.size === 0)
    throw new Error(`Expected non-empty file: ${path}`)
}

export async function verifyBuildArtifacts(
  artifactRoot: string,
  options: { requireBuildOutputs?: boolean } = {}
): Promise<ArtifactVerification> {
  const root = resolve(artifactRoot)
  const prepared = await new ArtifactRepository(root).prepare()
  if (options.requireBuildOutputs)
    await requireFile(join(root, 'server/server.js'))
  return {
    fragmentCount: prepared.fragments.size,
    templateCount: prepared.templates.size
  }
}

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (scriptPath === fileURLToPath(import.meta.url)) {
  const output = fileURLToPath(new URL('../dist', import.meta.url))
  const result = await verifyBuildArtifacts(output, {
    requireBuildOutputs: true
  })
  console.log(JSON.stringify({ event: 'build-artifacts-verified', ...result }))
}
