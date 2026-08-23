import type {
  CacheInvalidationEvent,
  CatalogResponse,
  CountryCode,
  Language,
  RenderVariant,
  User
} from '@lesshub/commerce-contracts'

export type CacheStatus = 'HIT' | 'MISS' | 'BYPASS' | 'NONE'
export type CacheRead<T> =
  | { status: 'HIT'; value: T }
  | { status: 'MISS' | 'BYPASS' }

export interface HtmlEnvelope {
  formatVersion: 1
  dataVersion: number
  bodyHtml: string
}

export interface DataEnvelope {
  schemaVersion: 1
  dataVersion: number
  payload: CatalogResponse
}

export interface CommerceClient {
  getCatalog(input: {
    countryCode: CountryCode
    language: Language
    requestId: string
  }): Promise<CatalogResponse>
  getUser(input: { userId: string; requestId: string }): Promise<User>
}

export interface PageCache {
  readHtml(key: string): Promise<CacheRead<HtmlEnvelope>>
  readData(
    key: string,
    expected: { countryCode: CountryCode; language: Language }
  ): Promise<CacheRead<DataEnvelope>>
  writeHtml(key: string, value: HtmlEnvelope, ttlSeconds: 30): Promise<boolean>
  writeData(key: string, value: DataEnvelope, ttlSeconds: 30): Promise<boolean>
  deleteKeys(keys: readonly string[]): Promise<boolean>
}

export interface ProductBodyRenderer {
  render(catalog: CatalogResponse): string
  renderError?(): string
}

export interface PageAssemblyInput {
  countryCode: CountryCode
  language: Language
  variant: RenderVariant
  cacheStatus: CacheStatus
  dataVersion?: number
  requestId: string
  bodyHtml: string
  csr: boolean
}

export interface DocumentAssembler {
  assemble(input: PageAssemblyInput): Promise<string>
}

export interface CoalescedResult<T> {
  value: T
  role: 'leader' | 'waiter'
  waitMs: number
}

export interface RequestCoalescer {
  run<T>(key: string, work: () => Promise<T>): Promise<CoalescedResult<T>>
}

export interface SessionPayload {
  version: 1
  userId: string
  expiresAt: number
}

export interface SessionCodec {
  encode(payload: SessionPayload): string
  decode(value: string): SessionPayload | undefined
}

export interface Logger {
  info(fields: Record<string, unknown>): void
  error(fields: Record<string, unknown>): void
}

export interface Clock {
  now(): number
}

export interface InvalidationHandler {
  invalidate(event: CacheInvalidationEvent): Promise<boolean>
  clearAll(): Promise<boolean>
  clearTarget?(input: {
    countryCode: CountryCode
    language: Language
    artifactType: 'page-html' | 'page-data'
  }): Promise<boolean>
}
