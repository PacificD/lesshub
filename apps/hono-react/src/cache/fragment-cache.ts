import { LRUCache } from 'lru-cache'
import {
  COUNTRIES,
  LANGUAGES,
  type CountryCode,
  type Language
} from '@lesshub/commerce-contracts'
import type { ArtifactRepository } from '../artifacts/repository.js'
import { buildCacheKey } from './cache-key.js'

interface FragmentCacheOptions {
  repository: ArtifactRepository
  max?: number
  ttlMs?: number
  now?: () => number
}

interface CachedFragment {
  content: string
  expiresAt: number
}

export interface FragmentReference {
  countryCode: CountryCode
  language: Language
  pageKey: 'navigation' | 'footer'
}

export class FragmentCache {
  readonly #repository: ArtifactRepository
  readonly #cache: LRUCache<string, CachedFragment>
  readonly #ttlMs: number
  readonly #now: () => number

  constructor(options: FragmentCacheOptions) {
    this.#repository = options.repository
    this.#ttlMs = options.ttlMs ?? 86_400_000
    this.#now = options.now ?? Date.now
    this.#cache = new LRUCache({ max: options.max ?? 100 })
  }

  get size(): number {
    return this.#cache.size
  }

  #set(key: string, content: string): void {
    this.#cache.set(key, {
      content,
      expiresAt: this.#now() + this.#ttlMs
    })
  }

  async prewarm(): Promise<number> {
    for (const countryCode of COUNTRIES) {
      for (const language of LANGUAGES) {
        for (const pageKey of ['navigation', 'footer'] as const) {
          const reference = { countryCode, language, pageKey }
          this.#set(
            buildCacheKey({ artifactType: 'fragment', ...reference }),
            await this.#repository.readFragment(reference)
          )
        }
      }
    }
    return this.#cache.size
  }

  async get(reference: FragmentReference): Promise<string> {
    const key = buildCacheKey({ artifactType: 'fragment', ...reference })
    const cached = this.#cache.get(key)
    if (cached && cached.expiresAt > this.#now()) return cached.content
    if (cached) this.#cache.delete(key)
    const content = await this.#repository.readFragment(reference)
    this.#set(key, content)
    return content
  }
}
