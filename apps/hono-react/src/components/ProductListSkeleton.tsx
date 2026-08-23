export function ProductListSkeleton() {
  return (
    <section
      className='catalog-skeleton'
      data-product-skeleton='products'
      aria-label='Products loading'
      aria-busy='true'
    >
      <div className='catalog-skeleton__heading' />
      <div className='catalog-skeleton__grid'>
        {Array.from({ length: 6 }, (_, index) => (
          <div className='catalog-skeleton__item' key={index} />
        ))}
      </div>
    </section>
  )
}
