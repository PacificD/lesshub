import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { COUNTRIES, LANGUAGES } from '@lesshub/commerce-contracts'
import { buildCacheKey } from '../cache/cache-key.js'
import { FragmentCache } from '../cache/fragment-cache.js'
import { slotToken, verifyDocumentSlots } from '../rendering/document-shell.js'
import {
  parseClientManifest,
  referencedClientFiles,
  type ClientManifest
} from './client-manifest.js'
import type { ArtifactEntry, BuildArtifactIndex } from './types.js'

const artifactEntrySchema = z
  .object({
    key: z.string().min(1).max(160),
    path: z.string().min(1).max(300),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()
const artifactIndexSchema = z
  .object({
    formatVersion: z.literal(1),
    fragments: z.array(artifactEntrySchema),
    templates: z.array(artifactEntrySchema),
    client: z
      .object({
        manifest: artifactEntrySchema,
        assets: z.array(artifactEntrySchema),
        staticAssets: z.array(artifactEntrySchema)
      })
      .strict()
  })
  .strict()

const TEMPLATE_KEYS = [
  'template:document-shell',
  'template:csr-fallback',
  'template:error-body'
] as const
const DYNAMIC_SEED_MARKERS = [
  'user-ada',
  'user-ren',
  'Ada Chen',
  'Ren Ito',
  'Field Notebook',
  '"priceMinor"',
  '"dataVersion"'
] as const

export interface ClientAssetMap {
  stylesheets: readonly string[]
  scripts: Readonly<Record<string, string>>
}

export interface PreparedArtifacts {
  fragments: ReadonlyMap<string, string>
  templates: ReadonlyMap<string, string>
  assets: ClientAssetMap
}

export interface PageRuntime extends PreparedArtifacts {
  repository: ArtifactRepository
  fragmentCache: FragmentCache
}

function sameMembers(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    actual.length === expected.length &&
    [...actual]
      .sort()
      .every((value, index) => value === [...expected].sort()[index])
  )
}

function portableClientPath(value: string): string {
  return value.split(sep).join('/')
}

function safeRelativePath(value: string): void {
  if (
    value.includes('\0') ||
    isAbsolute(value) ||
    value.split(/[\\/]/).some(segment => segment === '..')
  )
    throw new Error(`Unsafe artifact path: ${value}`)
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return (
    path === '' ||
    (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
  )
}

function expectedStaticAssetPaths(): string[] {
  return [
    ...Array.from(
      { length: 20 },
      (_, index) =>
        `client/images/product-${String(index + 1).padStart(2, '0')}.svg`
    ),
    'client/avatars/ada.svg',
    'client/avatars/ren.svg',
    'client/favicon.svg'
  ].sort()
}

function expectedFragmentKeys(): string[] {
  return COUNTRIES.flatMap(countryCode =>
    LANGUAGES.flatMap(language =>
      (['navigation', 'footer'] as const).map(pageKey =>
        buildCacheKey({
          artifactType: 'fragment',
          countryCode,
          language,
          pageKey
        })
      )
    )
  )
}

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export class ArtifactRepository {
  readonly #root: string
  #rootReal: string | undefined
  #index: BuildArtifactIndex | undefined
  #entries = new Map<string, ArtifactEntry>()

  constructor(root: string) {
    this.#root = resolve(root)
  }

  async #verifiedRead(entry: ArtifactEntry): Promise<string> {
    safeRelativePath(entry.path)
    const rootReal =
      this.#rootReal ?? (this.#rootReal = await realpath(this.#root))
    const candidate = join(rootReal, entry.path)
    let candidateReal: string
    try {
      candidateReal = await realpath(candidate)
    } catch {
      throw new Error(`Artifact file is missing: ${entry.path}`)
    }
    if (!inside(rootReal, candidateReal))
      throw new Error(`Artifact path escapes artifact root: ${entry.path}`)
    const details = await stat(candidateReal)
    if (!details.isFile() || details.size === 0)
      throw new Error(`Expected non-empty artifact file: ${entry.path}`)
    const content = await readFile(candidateReal, 'utf8')
    if (digest(content) !== entry.sha256)
      throw new Error(`Artifact checksum mismatch: ${entry.path}`)
    return content
  }

  async #loadAssets(
    manifest: ClientManifest,
    verifiedAssets: ReadonlyMap<string, string>
  ): Promise<ClientAssetMap> {
    const expectedPaths = referencedClientFiles(manifest).map(file =>
      portableClientPath(join('client', file))
    )
    if (!sameMembers([...verifiedAssets.keys()], expectedPaths))
      throw new Error(
        'Artifact index does not contain the exact manifest-referenced client assets'
      )

    const styles = new Set<string>()
    const scripts: Record<string, string> = {}
    for (const [source, entry] of Object.entries(manifest)) {
      const files = [entry.file, ...(entry.css ?? [])]
      for (const file of files) {
        safeRelativePath(file)
        if (!/^[A-Za-z0-9._/-]+$/.test(file))
          throw new Error(`Unsafe manifest asset path: ${file}`)
        if (!/-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/.test(file))
          throw new Error(`Manifest asset is not content-hashed: ${file}`)
        const indexedPath = portableClientPath(join('client', file))
        if (!verifiedAssets.has(indexedPath))
          throw new Error(`Manifest asset is not checksum-indexed: ${file}`)
        const url = `/${file}`
        if (file.endsWith('.css')) styles.add(url)
        if (file.endsWith('.js') && entry.isEntry) scripts[source] = url
      }
    }
    if (styles.size === 0)
      throw new Error('Vite manifest must expose at least one stylesheet')
    return {
      stylesheets: [...styles].sort(),
      scripts: Object.freeze({ ...scripts })
    }
  }

  async prepare(): Promise<PreparedArtifacts> {
    this.#rootReal = await realpath(this.#root)
    const parsed = artifactIndexSchema.parse(
      JSON.parse(
        await readFile(join(this.#root, 'artifact-index.json'), 'utf8')
      )
    )
    const fragmentKeys = parsed.fragments.map(entry => entry.key)
    if (!sameMembers(fragmentKeys, expectedFragmentKeys()))
      throw new Error(
        'Artifact index does not contain the exact expected fragment keys'
      )
    const templateKeys = parsed.templates.map(entry => entry.key)
    if (!sameMembers(templateKeys, TEMPLATE_KEYS))
      throw new Error(
        'Artifact index does not contain the exact expected template keys'
      )
    if (
      parsed.client.manifest.key !== 'client:manifest' ||
      parsed.client.manifest.path !== 'client/.vite/manifest.json'
    )
      throw new Error(
        'Artifact index must contain the canonical client manifest'
      )
    if (
      !sameMembers(
        parsed.client.staticAssets.map(entry => entry.path),
        expectedStaticAssetPaths()
      )
    )
      throw new Error(
        'Artifact index does not contain the exact expected static client assets'
      )
    const allEntries = [
      ...parsed.fragments,
      ...parsed.templates,
      parsed.client.manifest,
      ...parsed.client.assets,
      ...parsed.client.staticAssets
    ]
    if (new Set(allEntries.map(entry => entry.key)).size !== allEntries.length)
      throw new Error('Artifact keys must be unique')
    if (new Set(allEntries.map(entry => entry.path)).size !== allEntries.length)
      throw new Error('Artifact paths must be unique')

    this.#index = parsed
    this.#entries = new Map(allEntries.map(entry => [entry.key, entry]))
    const fragments = new Map<string, string>()
    const templates = new Map<string, string>()
    for (const entry of parsed.fragments) {
      const content = await this.#verifiedRead(entry)
      if (DYNAMIC_SEED_MARKERS.some(marker => content.includes(marker)))
        throw new Error(
          `Build artifact contains dynamic seed data: ${entry.path}`
        )
      fragments.set(entry.key, content)
    }
    for (const entry of parsed.templates) {
      const content = await this.#verifiedRead(entry)
      if (DYNAMIC_SEED_MARKERS.some(marker => content.includes(marker)))
        throw new Error(
          `Build artifact contains dynamic seed data: ${entry.path}`
        )
      templates.set(entry.key, content)
    }
    verifyDocumentSlots(templates.get('template:document-shell') ?? '')

    const manifest = parseClientManifest(
      await this.#verifiedRead(parsed.client.manifest)
    )
    const verifiedAssets = new Map<string, string>()
    for (const entry of parsed.client.assets)
      verifiedAssets.set(entry.path, await this.#verifiedRead(entry))
    for (const entry of parsed.client.staticAssets)
      await this.#verifiedRead(entry)

    return {
      fragments,
      templates,
      assets: await this.#loadAssets(manifest, verifiedAssets)
    }
  }

  fragmentEntry(reference: {
    countryCode: (typeof COUNTRIES)[number]
    language: (typeof LANGUAGES)[number]
    pageKey: 'navigation' | 'footer'
  }): ArtifactEntry {
    const key = buildCacheKey({ artifactType: 'fragment', ...reference })
    const entry = this.#entries.get(key)
    if (!entry) throw new Error(`Build fragment not found: ${key}`)
    return entry
  }

  async readFragment(reference: {
    countryCode: (typeof COUNTRIES)[number]
    language: (typeof LANGUAGES)[number]
    pageKey: 'navigation' | 'footer'
  }): Promise<string> {
    return this.#verifiedRead(this.fragmentEntry(reference))
  }
}

function trustedAssetUrl(value: string): string {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value))
    throw new Error(`Unsafe client asset URL: ${value}`)
  return value
}

export function injectClientAssets(
  shell: string,
  assets: ClientAssetMap
): string {
  const token = slotToken('client-assets')
  if (shell.split(token).length - 1 !== 1)
    throw new Error(
      'Document shell must contain exactly one trusted client-assets slot'
    )
  const tags = [
    ...assets.stylesheets.map(
      href => `<link rel="stylesheet" href="${trustedAssetUrl(href)}">`
    ),
    ...Object.values(assets.scripts).map(
      src => `<script type="module" src="${trustedAssetUrl(src)}"></script>`
    )
  ].join('\n')
  return shell.replace(token, tags)
}

export async function preparePageRuntime(root: string): Promise<PageRuntime> {
  const repository = new ArtifactRepository(root)
  const prepared = await repository.prepare()
  const fragmentCache = new FragmentCache({ repository })
  await fragmentCache.prewarm()
  return { ...prepared, repository, fragmentCache }
}
