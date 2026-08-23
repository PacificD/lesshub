import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateBuildArtifacts } from '../scripts/generate-build-artifacts.js'
import { verifyBuildArtifacts } from '../scripts/verify-build-artifacts.js'
import {
  ArtifactRepository,
  injectClientAssets,
  preparePageRuntime
} from '../src/artifacts/repository.js'
import type { BuildArtifactIndex } from '../src/artifacts/types.js'
import { FragmentCache } from '../src/cache/fragment-cache.js'
import { materializeNavigationVariant } from '../src/rendering/navigation-variant.js'

const directories: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lesshub-artifacts-'))
  directories.push(root)
  await mkdir(join(root, 'client/.vite'), { recursive: true })
  await mkdir(join(root, 'client/assets'), { recursive: true })
  await mkdir(join(root, 'client/images'), { recursive: true })
  await mkdir(join(root, 'client/avatars'), { recursive: true })
  await mkdir(join(root, 'server'), { recursive: true })
  await writeFile(join(root, 'client/assets/global-abc123.css'), ':root{}')
  await writeFile(
    join(root, 'client/.vite/manifest.json'),
    JSON.stringify({
      'src/styles/global.css': {
        file: 'assets/global-abc123.css',
        src: 'src/styles/global.css',
        isEntry: true
      }
    })
  )
  for (let index = 1; index <= 20; index += 1)
    await writeFile(
      join(root, `client/images/product-${String(index).padStart(2, '0')}.svg`),
      `<svg data-product="${index}"/>`
    )
  await writeFile(join(root, 'client/avatars/ada.svg'), '<svg data-avatar="ada"/>')
  await writeFile(join(root, 'client/avatars/ren.svg'), '<svg data-avatar="ren"/>')
  await writeFile(join(root, 'client/favicon.svg'), '<svg data-favicon="true"/>')
  await generateBuildArtifacts(root)
  await writeFile(join(root, 'server/server.js'), 'export {}')
  return root
}

async function rewriteIndex(
  root: string,
  mutate: (index: BuildArtifactIndex) => void
): Promise<void> {
  const path = join(root, 'artifact-index.json')
  const index = JSON.parse(await readFile(path, 'utf8')) as BuildArtifactIndex
  mutate(index)
  await writeFile(path, JSON.stringify(index))
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(
    directories
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true }))
  )
})

describe('runtime artifact repository seam', () => {
  it('validates, prewarms, and exposes a typed asset map before startup', async () => {
    const root = await fixture()
    const runtime = await preparePageRuntime(root)
    expect(runtime.fragmentCache.size).toBe(24)
    expect(runtime.assets.stylesheets).toEqual(['/assets/global-abc123.css'])
    expect(
      await runtime.fragmentCache.get({
        countryCode: 'GB',
        language: 'ja-JP',
        pageKey: 'navigation'
      })
    ).toContain('data-fragment="navigation"')
    expect(
      injectClientAssets(
        '<head><!--slot:client-assets--></head>',
        runtime.assets
      )
    ).toBe(
      '<head><link rel="stylesheet" href="/assets/global-abc123.css"></head>'
    )
  })

  it('rejects traversal and a symlink that escapes the artifact root', async () => {
    const root = await fixture()
    await rewriteIndex(root, index => {
      index.fragments[0]!.path = '../outside.html'
    })
    await expect(new ArtifactRepository(root).prepare()).rejects.toThrow(
      /unsafe artifact path/i
    )

    const linkedRoot = await fixture()
    const outside = join(
      await mkdtemp(join(tmpdir(), 'lesshub-outside-')),
      'x.html'
    )
    directories.push(join(outside, '..'))
    await writeFile(outside, 'outside')
    const link = join(linkedRoot, 'fragments/escape.html')
    await symlink(outside, link)
    await rewriteIndex(linkedRoot, index => {
      index.fragments[0]!.path = 'fragments/escape.html'
      index.fragments[0]!.sha256 = createHash('sha256')
        .update('outside')
        .digest('hex')
    })
    await expect(new ArtifactRepository(linkedRoot).prepare()).rejects.toThrow(
      /escapes artifact root/i
    )
  })

  it('rejects checksum corruption, missing client assets, and leaked seed data', async () => {
    const checksumRoot = await fixture()
    const checksumIndex = JSON.parse(
      await readFile(join(checksumRoot, 'artifact-index.json'), 'utf8')
    ) as BuildArtifactIndex
    await writeFile(
      join(checksumRoot, checksumIndex.fragments[0]!.path),
      'changed'
    )
    await expect(
      new ArtifactRepository(checksumRoot).prepare()
    ).rejects.toThrow(/checksum mismatch/i)

    const missingAssetRoot = await fixture()
    await rm(join(missingAssetRoot, 'client/assets/global-abc123.css'))
    await expect(
      new ArtifactRepository(missingAssetRoot).prepare()
    ).rejects.toThrow(/artifact file is missing/i)

    const missingStaticRoot = await fixture()
    await rm(join(missingStaticRoot, 'client/images/product-20.svg'))
    await expect(
      new ArtifactRepository(missingStaticRoot).prepare()
    ).rejects.toThrow(/artifact file is missing/i)

    const changedStaticRoot = await fixture()
    await writeFile(
      join(changedStaticRoot, 'client/images/product-01.svg'),
      '<svg>tampered product</svg>'
    )
    await expect(
      new ArtifactRepository(changedStaticRoot).prepare()
    ).rejects.toThrow(/checksum mismatch/i)

    const leakageRoot = await fixture()
    const indexPath = join(leakageRoot, 'artifact-index.json')
    const leakageIndex = JSON.parse(
      await readFile(indexPath, 'utf8')
    ) as BuildArtifactIndex
    const template = leakageIndex.templates.find(
      entry => entry.key === 'template:error-body'
    )!
    const leaked = '<main>Ada Chen user-ada</main>'
    await writeFile(join(leakageRoot, template.path), leaked)
    template.sha256 = createHash('sha256').update(leaked).digest('hex')
    await writeFile(indexPath, JSON.stringify(leakageIndex))
    await expect(new ArtifactRepository(leakageRoot).prepare()).rejects.toThrow(
      /dynamic seed data/i
    )
  })

  it('requires the exact template set and verifies production build outputs', async () => {
    const root = await fixture()
    await rewriteIndex(root, index => {
      index.templates.pop()
    })
    await expect(new ArtifactRepository(root).prepare()).rejects.toThrow(
      /template keys/i
    )

    const validRoot = await fixture()
    await expect(
      verifyBuildArtifacts(validRoot, { requireBuildOutputs: true })
    ).resolves.toEqual({ fragmentCount: 24, templateCount: 3 })
  })

  it('rejects a self-consistent shell index with invalid slots at startup', async () => {
    const root = await fixture()
    const indexPath = join(root, 'artifact-index.json')
    const index = JSON.parse(
      await readFile(indexPath, 'utf8')
    ) as BuildArtifactIndex
    const shell = index.templates.find(
      entry => entry.key === 'template:document-shell'
    )!
    const invalidShell = createHash('sha256')
    const shellPath = join(root, shell.path)
    const changed = (await readFile(shellPath, 'utf8')).replace(
      '<!--slot:footer-->',
      ''
    )
    await writeFile(shellPath, changed)
    shell.sha256 = invalidShell.update(changed).digest('hex')
    await writeFile(indexPath, JSON.stringify(index))

    await expect(new ArtifactRepository(root).prepare()).rejects.toThrow(
      /exactly one/i
    )
  })

  it('rejects an in-place client asset mutation with an unchanged hashed filename', async () => {
    const root = await fixture()
    await writeFile(
      join(root, 'client/assets/global-abc123.css'),
      ':root{color:red}'
    )
    await expect(new ArtifactRepository(root).prepare()).rejects.toThrow(
      /checksum mismatch/i
    )
  })

  it('rechecks disk checksums after an expired prewarmed value', async () => {
    const root = await fixture()
    const repository = new ArtifactRepository(root)
    await repository.prepare()
    const cache = new FragmentCache({ repository, max: 1, ttlMs: 1 })
    await cache.prewarm()
    const reference = {
      countryCode: 'GB' as const,
      language: 'en-US' as const,
      pageKey: 'navigation' as const
    }
    const entry = repository.fragmentEntry(reference)
    await new Promise(resolve => setTimeout(resolve, 5))
    await writeFile(join(root, entry.path), 'corrupt after prewarm')
    await expect(cache.get(reference)).rejects.toThrow(/checksum mismatch/i)
  })

  it('expires and evicts LRU values under a fake clock', async () => {
    let now = 0
    const readFragment = vi.fn(async (reference: unknown) =>
      JSON.stringify(reference)
    )
    const repository = { readFragment } as unknown as ArtifactRepository
    const cache = new FragmentCache({
      repository,
      max: 1,
      ttlMs: 10,
      now: () => now
    })
    const navigation = {
      countryCode: 'GB' as const,
      language: 'en-US' as const,
      pageKey: 'navigation' as const
    }
    const footer = { ...navigation, pageKey: 'footer' as const }

    await cache.get(navigation)
    now = 20
    await cache.get(navigation)
    expect(readFragment).toHaveBeenCalledTimes(2)

    await cache.get(footer)
    await cache.get(navigation)
    expect(readFragment).toHaveBeenCalledTimes(4)
  })

  it('materializes all approved variants without navigation falling back to html-cache', async () => {
    const root = await fixture()
    const repository = new ArtifactRepository(root)
    const prepared = await repository.prepare()
    const navigation = prepared.fragments.get(
      'v1:fragment:GB:ja-JP:navigation'
    )!
    expect(navigation).toContain('市場')
    expect(navigation).toContain('lh-user-menu-')
    expect(
      prepared.fragments.get('v1:fragment:SG:zh-CN:navigation')
    ).toContain('国家与市场')
    for (const variant of [
      'html-cache',
      'data-cache',
      'live-ssr',
      'csr'
    ] as const) {
      const html = materializeNavigationVariant(navigation, variant)
      expect(html).toContain(`/gb/ja-jp/benchmark/${variant}/products`)
      expect(html).toContain(`/sg/ja-jp/benchmark/${variant}/products`)
      expect(html).not.toContain('__LESSHUB_RENDER_VARIANT__')
    }
  })
})
