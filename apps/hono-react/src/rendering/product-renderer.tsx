import { renderToString } from 'react-dom/server'
import type { ProductBodyRenderer } from '../runtime/interfaces.js'
import { ProductList } from '../components/ProductList.js'
import { ErrorPage } from '../components/ErrorPage.js'

export const reactProductBodyRenderer: ProductBodyRenderer = {
  render: catalog => renderToString(<ProductList catalog={catalog} />),
  renderError: () => renderToString(<ErrorPage />)
}
