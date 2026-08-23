export const BENCHMARK_BROWSER_INIT_SCRIPT = String.raw`
(() => {
  window.__lesshubBenchmarkInit = 'started'
  window.__lesshubBenchmarkInitError = null
  try {
    let scheduled = false
    let observer
    const markOnce = () => {
      if (scheduled) return
      if (performance.getEntriesByName('lesshub:products-visible').length > 0) {
        if (observer) observer.disconnect()
        return
      }
      const product = document.querySelector('[data-product-id]')
      if (!product) return
      scheduled = true
      requestAnimationFrame(() => {
        if (performance.getEntriesByName('lesshub:products-visible').length === 0)
          performance.mark('lesshub:products-visible')
        if (observer) observer.disconnect()
      })
    }
    observer = new MutationObserver(markOnce)
    observer.observe(document, { childList: true, subtree: true })
    document.addEventListener('readystatechange', markOnce)
    window.addEventListener('DOMContentLoaded', markOnce, { once: true })
    window.addEventListener('load', markOnce, { once: true })
    window.__lesshubHydrationErrors = []
    window.addEventListener('lesshub:hydration-error', event =>
      window.__lesshubHydrationErrors.push(String(event.detail))
    )
    window.__lesshubLcp = 0
    if (PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint'))
      new PerformanceObserver(list => {
        window.__lesshubLcp = Math.max(
          window.__lesshubLcp,
          ...list.getEntries().map(entry => entry.startTime)
        )
      }).observe({ type: 'largest-contentful-paint', buffered: true })
    window.__lesshubBenchmarkInit = 'ready'
  } catch (error) {
    window.__lesshubBenchmarkInitError = String(error)
  }
})()
`
