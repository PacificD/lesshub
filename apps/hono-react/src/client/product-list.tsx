import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  catalogResponseSchema,
  type CatalogResponse
} from '@lesshub/commerce-contracts'
import { ProductList } from '../components/ProductList.js'
import { ProductListSkeleton } from '../components/ProductListSkeleton.js'

function CatalogIsland({ country, language }: { country: string; language: string }) {
  const [catalog, setCatalog] = useState<CatalogResponse>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const load = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    document
      .querySelector<HTMLElement>('[data-csr-fallback]')
      ?.setAttribute('hidden', '')
    setError(false)
    performance.mark('lesshub:catalog:start')
    void fetch(
      `/api/catalog?country=${encodeURIComponent(country)}&language=${encodeURIComponent(language)}`,
      { cache: 'no-store', signal: controller.signal }
    )
      .then(async response => {
        if (!response.ok) throw new Error('catalog request failed')
        return catalogResponseSchema.parse(await response.json())
      })
      .then(value => {
        performance.mark('lesshub:catalog:end')
        performance.measure('lesshub:catalog', 'lesshub:catalog:start', 'lesshub:catalog:end')
        setCatalog(value)
      })
      .catch(reason => {
        if ((reason as Error).name !== 'AbortError') setError(true)
      })
    return () => controller.abort()
  }, [attempt, country, language])

  if (catalog) return <ProductList catalog={catalog} />
  if (error)
    return (
      <section className='csr-error' role='alert'>
        <h2>Catalog temporarily unavailable.</h2>
        <button type='button' onClick={load}>Retry catalog</button>
      </section>
    )
  return <ProductListSkeleton />
}

const rootElement = document.getElementById('product-list-root')
const context = rootElement?.closest<HTMLElement>('[data-country][data-language]')
if (rootElement && context) {
  createRoot(rootElement, { identifierPrefix: 'lh-product-list-' }).render(
    <CatalogIsland
      country={context.dataset.country ?? ''}
      language={context.dataset.language ?? ''}
    />
  )
}
