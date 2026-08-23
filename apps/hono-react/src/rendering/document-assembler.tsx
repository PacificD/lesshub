import { renderToString } from 'react-dom/server'
import type { PageRuntime } from '../artifacts/repository.js'
import { RenderLedger } from '../components/RenderLedger.js'
import type {
  DocumentAssembler,
  PageAssemblyInput
} from '../runtime/interfaces.js'
import { materializeNavigationVariant } from './navigation-variant.js'
import { slotToken } from './document-shell.js'

const USER_MENU_ENTRY = 'src/client/user-menu.tsx'
const PRODUCT_LIST_ENTRY = 'src/client/product-list.tsx'

function assetUrl(value: string): string {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value))
    throw new Error('Unsafe client asset URL')
  return value
}

function assetTags(runtime: PageRuntime, csr: boolean): string {
  const scripts = [USER_MENU_ENTRY, ...(csr ? [PRODUCT_LIST_ENTRY] : [])]
  const tags = runtime.assets.stylesheets.map(
    href => `<link rel="stylesheet" href="${assetUrl(href)}">`
  )
  for (const source of scripts) {
    const src = runtime.assets.scripts[source]
    if (!src) throw new Error(`Required client entry is missing: ${source}`)
    tags.push(`<script type="module" src="${assetUrl(src)}"></script>`)
  }
  return tags.join('\n')
}

function replaceOnce(source: string, token: string, value: string): string {
  if (source.split(token).length - 1 !== 1)
    throw new Error(`Document requires exactly one token: ${token}`)
  return source.replace(token, value)
}

export function createDocumentAssembler(runtime: PageRuntime): DocumentAssembler {
  return {
    async assemble(input: PageAssemblyInput): Promise<string> {
      const shell = runtime.templates.get('template:document-shell')
      const fallback = runtime.templates.get('template:csr-fallback')
      if (!shell || !fallback) throw new Error('Required templates are unavailable')
      const navigation = materializeNavigationVariant(
        await runtime.fragmentCache.get({
          countryCode: input.countryCode,
          language: input.language,
          pageKey: 'navigation'
        }),
        input.variant
      )
      const footer = await runtime.fragmentCache.get({
        countryCode: input.countryCode,
        language: input.language,
        pageKey: 'footer'
      })
      const ledger = renderToString(
        <RenderLedger
          variant={input.variant}
          cacheStatus={input.cacheStatus}
          countryCode={input.countryCode}
          language={input.language}
          dataVersion={input.dataVersion}
          requestId={input.requestId}
        />
      )
      const body = input.csr
        ? `<main>${ledger}<section class="csr-catalog" data-country="${input.countryCode}" data-language="${input.language}"><div class="csr-catalog__fallback" data-csr-fallback>${fallback}</div><div id="product-list-root"></div></section></main>`
        : `<main>${ledger}${input.bodyHtml}</main>`

      let document = shell
      document = replaceOnce(
        document,
        '<!--document:language-->',
        input.language
      )
      document = replaceOnce(
        document,
        '<!--document:country-->',
        input.countryCode
      )
      document = replaceOnce(document, slotToken('navigation'), navigation)
      document = replaceOnce(document, slotToken('page-body'), body)
      document = replaceOnce(document, slotToken('footer'), footer)
      document = replaceOnce(
        document,
        slotToken('client-assets'),
        assetTags(runtime, input.csr)
      )
      return document
    }
  }
}
