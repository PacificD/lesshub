import {
  currencyForCountry,
  type CatalogResponse,
  type CountryCode,
  type Language,
  type Product,
  type TranslationMutation,
  type User
} from '@lesshub/commerce-contracts'
import { PRODUCT_SEED, USER_SEED, type StoredProduct } from './seed.js'

function cloneProducts(): StoredProduct[] {
  return structuredClone([...PRODUCT_SEED])
}

function availabilityFor(inventory: number): Product['availability'] {
  if (inventory === 0) return 'out-of-stock'
  if (inventory < 5) return 'low-stock'
  return 'in-stock'
}

export interface CatalogStore {
  catalog(countryCode: CountryCode, language: Language): CatalogResponse
  user(userId: string): User | undefined
  setPrice(
    productId: string,
    countryCode: CountryCode,
    priceMinor: number
  ): number
  setInventory(productId: string, inventory: number): number
  setTranslation(
    productId: string,
    language: Language,
    translation: TranslationMutation
  ): number
  reset(): number
}

export function createCatalogStore(): CatalogStore {
  let products = cloneProducts()
  let dataVersion = 1

  function requiredProduct(productId: string): StoredProduct {
    const product = products.find(candidate => candidate.id === productId)
    if (!product) throw new RangeError(`Unknown product: ${productId}`)
    return product
  }

  function markUpdated(product: StoredProduct): number {
    dataVersion += 1
    product.updatedAt = new Date(
      Date.UTC(2026, 0, 1, 0, 0, dataVersion)
    ).toISOString()
    return dataVersion
  }

  return {
    catalog(countryCode, language) {
      const currency = currencyForCountry(countryCode)
      return {
        countryCode,
        language,
        currency,
        dataVersion,
        products: products.map(product => ({
          id: product.id,
          slug: product.slug,
          name: product.translations[language].name,
          description: product.translations[language].description,
          category: product.category,
          imageUrl: product.imageUrl,
          priceMinor: product.prices[countryCode],
          currency,
          inventory: product.inventory,
          availability: availabilityFor(product.inventory),
          updatedAt: product.updatedAt
        }))
      }
    },
    user(userId) {
      return USER_SEED.find(user => user.id === userId)
    },
    setPrice(productId, countryCode, priceMinor) {
      const product = requiredProduct(productId)
      product.prices[countryCode] = priceMinor
      return markUpdated(product)
    },
    setInventory(productId, inventory) {
      const product = requiredProduct(productId)
      product.inventory = inventory
      return markUpdated(product)
    },
    setTranslation(productId, language, translation) {
      const product = requiredProduct(productId)
      product.translations[language] = translation
      return markUpdated(product)
    },
    reset() {
      products = cloneProducts()
      dataVersion = 1
      return dataVersion
    }
  }
}
