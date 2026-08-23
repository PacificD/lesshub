import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { COUNTRIES, LANGUAGES } from '@lesshub/commerce-contracts'
import { buildCacheKey } from '../src/cache/cache-key.js'
import { ErrorPage } from '../src/components/ErrorPage.js'
import { Footer } from '../src/components/Footer.js'
import { Navigation } from '../src/components/Navigation.js'
import { ProductListSkeleton } from '../src/components/ProductListSkeleton.js'
import { USER_MENU_IDENTIFIER_PREFIX } from '../src/components/UserMenuSkeleton.js'
import {
  createDocumentShell,
  verifyDocumentSlots
} from '../src/rendering/document-shell.js'
import {
  parseClientManifest,
  referencedClientFiles
} from '../src/artifacts/client-manifest.js'
import type {
  ArtifactEntry,
  BuildArtifactIndex,
  ClientArtifactIndex
} from '../src/artifacts/types.js'

function digest(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function portablePath(path: string): string {
  return path.split(sep).join('/')
}

async function writeArtifact(
  root: string,
  path: string,
  key: string,
  content: string
): Promise<ArtifactEntry> {
  const absolutePath = join(root, path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
  return {
    key,
    path: portablePath(relative(root, absolutePath)),
    sha256: digest(content)
  }
}

function safeClientPath(path: string): void {
  if (
    path.includes('\0') ||
    isAbsolute(path) ||
    path.split(/[\\/]/).some(segment => segment === '..')
  )
    throw new Error(`Unsafe client asset path: ${path}`)
}

async function existingArtifact(
  root: string,
  path: string,
  key: string
): Promise<ArtifactEntry> {
  safeClientPath(path)
  const content = await readFile(join(root, path), 'utf8')
  return { key, path: portablePath(path), sha256: digest(content) }
}

const STATIC_CLIENT_FILES = [
  ...Array.from(
    { length: 20 },
    (_, index) => `images/product-${String(index + 1).padStart(2, '0')}.svg`
  ),
  'avatars/ada.svg',
  'avatars/ren.svg',
  'favicon.svg'
] as const

async function indexClientArtifacts(
  root: string
): Promise<ClientArtifactIndex> {
  const manifestPath = 'client/.vite/manifest.json'
  const manifest = await existingArtifact(root, manifestPath, 'client:manifest')
  const parsed = parseClientManifest(
    await readFile(join(root, manifestPath), 'utf8')
  )
  const assets = await Promise.all(
    referencedClientFiles(parsed).map(file => {
      safeClientPath(file)
      return existingArtifact(
        root,
        join('client', file),
        `client:asset:${portablePath(file)}`
      )
    })
  )
  const staticAssets = await Promise.all(
    STATIC_CLIENT_FILES.map(file =>
      existingArtifact(
        root,
        join('client', file),
        `client:static:${portablePath(file)}`
      )
    )
  )
  return {
    manifest,
    assets: assets.sort((left, right) => left.key.localeCompare(right.key)),
    staticAssets: staticAssets.sort((left, right) =>
      left.key.localeCompare(right.key)
    )
  }
}

export async function generateBuildArtifacts(
  artifactRoot: string
): Promise<BuildArtifactIndex> {
  const root = resolve(artifactRoot)
  const fragments: ArtifactEntry[] = []

  for (const countryCode of COUNTRIES) {
    for (const language of LANGUAGES) {
      const localeDirectory = join('fragments', countryCode, language)
      const navigation = renderToString(
        <Navigation countryCode={countryCode} language={language} />,
        { identifierPrefix: USER_MENU_IDENTIFIER_PREFIX }
      )
      const footer = renderToString(
        <Footer countryCode={countryCode} language={language} />
      )
      fragments.push(
        await writeArtifact(
          root,
          join(localeDirectory, 'navigation.html'),
          buildCacheKey({
            artifactType: 'fragment',
            countryCode,
            language,
            pageKey: 'navigation'
          }),
          navigation
        )
      )
      fragments.push(
        await writeArtifact(
          root,
          join(localeDirectory, 'footer.html'),
          buildCacheKey({
            artifactType: 'fragment',
            countryCode,
            language,
            pageKey: 'footer'
          }),
          footer
        )
      )
    }
  }

  const shell = createDocumentShell()
  verifyDocumentSlots(shell)
  const templates = [
    await writeArtifact(
      root,
      'templates/document-shell.html',
      'template:document-shell',
      shell
    ),
    await writeArtifact(
      root,
      'templates/csr-fallback.html',
      'template:csr-fallback',
      renderToString(<ProductListSkeleton />)
    ),
    await writeArtifact(
      root,
      'templates/error-body.html',
      'template:error-body',
      renderToString(<ErrorPage />)
    )
  ]

  const index: BuildArtifactIndex = {
    formatVersion: 1,
    fragments: fragments.sort((left, right) =>
      left.key.localeCompare(right.key)
    ),
    templates: templates.sort((left, right) =>
      left.key.localeCompare(right.key)
    ),
    client: await indexClientArtifacts(root)
  }
  await writeFile(
    join(root, 'artifact-index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8'
  )
  return index
}

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (scriptPath === fileURLToPath(import.meta.url)) {
  const output = fileURLToPath(new URL('../dist', import.meta.url))
  const index = await generateBuildArtifacts(output)
  console.log(
    JSON.stringify({
      event: 'build-artifacts-generated',
      fragments: index.fragments.length,
      templates: index.templates.length,
      clientAssets: index.client.assets.length,
      staticAssets: index.client.staticAssets.length
    })
  )
}
