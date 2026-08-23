import type { CatalogResponse, Product } from '@lesshub/commerce-contracts'

const copy: Record<
  CatalogResponse['language'],
  {
    eyebrow: string
    heading: string
    intro: string
    inStock: string
    outOfStock: string
    only: (count: number) => string
  }
> = {
  'en-US': {
    eyebrow: 'Twenty objects / one controlled dataset',
    heading: 'Field notes for the working table.',
    intro:
      'Durable tools arranged as an editorial ledger. Market controls price; language controls the words.',
    inStock: 'In stock',
    outOfStock: 'Out of stock',
    only: count => `Only ${count} left`
  },
  'ja-JP': {
    eyebrow: '20の道具 / 同一の検証データ',
    heading: '仕事机のためのフィールドノート。',
    intro:
      '丈夫な道具を編集台帳として配置。市場は価格を、言語は言葉を決めます。',
    inStock: '在庫あり',
    outOfStock: '在庫切れ',
    only: count => `残り${count}点`
  },
  'zh-CN': {
    eyebrow: '20件物品 / 同一份受控数据',
    heading: '工作桌上的野外笔记。',
    intro: '耐用工具以编辑台账排列。国家决定价格与货币，语言决定文字。',
    inStock: '有库存',
    outOfStock: '缺货',
    only: count => `仅剩${count}件`
  }
}

function price(product: Product, language: CatalogResponse['language']): string {
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: product.currency
  }).format(product.priceMinor / (product.currency === 'JPY' ? 1 : 100))
}

function ProductCard({
  product,
  language,
  index
}: {
  product: Product
  language: CatalogResponse['language']
  index: number
}) {
  return (
    <article className='product-entry' data-product-id={product.id}>
      <div className='product-entry__number' aria-hidden='true'>
        {String(index + 1).padStart(2, '0')}
      </div>
      <img
        className='product-entry__image'
        src={product.imageUrl}
        width='480'
        height='360'
        loading={index < 3 ? 'eager' : 'lazy'}
        alt={`${product.name} — ${product.category}`}
      />
      <div className='product-entry__copy'>
        <p className='product-entry__category'>{product.category}</p>
        <h2>{product.name}</h2>
        <p>{product.description}</p>
      </div>
      <div className='product-entry__facts'>
        <strong>{price(product, language)}</strong>
        <span data-availability={product.availability}>
          {product.availability === 'out-of-stock'
            ? copy[language].outOfStock
            : product.availability === 'low-stock'
              ? copy[language].only(product.inventory)
              : copy[language].inStock}
        </span>
      </div>
    </article>
  )
}

export function ProductList({ catalog }: { catalog: CatalogResponse }) {
  return (
    <section className='catalog' data-product-list data-version={catalog.dataVersion}>
      <header className='catalog__header'>
        <p className='eyebrow'>{copy[catalog.language].eyebrow}</p>
        <h1>{copy[catalog.language].heading}</h1>
        <p className='catalog__intro'>{copy[catalog.language].intro}</p>
      </header>
      <div className='catalog__list'>
        {catalog.products.map((product, index) => (
          <ProductCard
            key={product.id}
            product={product}
            language={catalog.language}
            index={index}
          />
        ))}
      </div>
    </section>
  )
}
