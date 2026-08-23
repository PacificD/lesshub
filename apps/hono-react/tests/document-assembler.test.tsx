import { describe, expect, it } from 'vitest'
import type { PageRuntime } from '../src/artifacts/repository.js'
import { createDocumentAssembler } from '../src/rendering/document-assembler.js'
import { createDocumentShell } from '../src/rendering/document-shell.js'

function runtime(): PageRuntime {
  const navigation = '<nav><a href="/gb/en-us/benchmark/__LESSHUB_RENDER_VARIANT__/products">Market</a><div data-island="user-menu"></div></nav>'
  return {
    fragments: new Map(),
    templates: new Map([
      ['template:document-shell', createDocumentShell()],
      ['template:csr-fallback', '<div>loading products</div>'],
      ['template:error-body', '<main>error</main>']
    ]),
    assets: {
      stylesheets: ['/assets/global-abc123.css'],
      scripts: {
        'src/client/user-menu.tsx': '/assets/user-menu-abc123.js',
        'src/client/product-list.tsx': '/assets/product-list-abc123.js'
      }
    },
    repository: {} as PageRuntime['repository'],
    fragmentCache: {
      size: 24,
      get: async reference =>
        reference.pageKey === 'navigation' ? navigation : '<footer>footer</footer>'
    } as PageRuntime['fragmentCache']
  }
}

const base = {
  countryCode: 'GB' as const,
  language: 'en-US' as const,
  requestId: 'abcdefgh-1234',
  cacheStatus: 'MISS' as const,
  dataVersion: 2
}

describe('document assembler seam', () => {
  it('loads only user-menu JS for SSR and preserves the active navigation variant', async () => {
    const html = await createDocumentAssembler(runtime()).assemble({
      ...base,
      variant: 'data-cache',
      bodyHtml: '<section data-product-list>products</section>',
      csr: false
    })
    expect(html).toContain('/benchmark/data-cache/products')
    expect(html).toContain('/assets/user-menu-abc123.js')
    expect(html).not.toContain('/assets/product-list-abc123.js')
    expect(html).toContain('data-product-list')
  })

  it('loads product-list JS only for CSR and keeps the React root empty', async () => {
    const html = await createDocumentAssembler(runtime()).assemble({
      ...base,
      variant: 'csr',
      bodyHtml: '',
      csr: true
    })
    expect(html).toContain('/assets/user-menu-abc123.js')
    expect(html).toContain('/assets/product-list-abc123.js')
    expect(html).toContain('<div id="product-list-root"></div>')
    expect(html).toContain('data-csr-fallback')
  })
})
