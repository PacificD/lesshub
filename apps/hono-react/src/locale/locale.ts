import {
  COUNTRIES,
  LANGUAGES,
  countryCodeSchema,
  languageSchema,
  type CountryCode,
  type Language
} from '@lesshub/commerce-contracts'

const countriesByUrl = new Map(
  COUNTRIES.map(country => [country.toLowerCase(), country])
)
const languagesByUrl = new Map(
  LANGUAGES.map(language => [language.toLowerCase(), language])
)

export interface Locale {
  countryCode: CountryCode
  language: Language
}

export function countryFromUrl(
  value: string | undefined
): CountryCode | undefined {
  return value ? countriesByUrl.get(value.toLowerCase()) : undefined
}

export function languageFromUrl(
  value: string | undefined
): Language | undefined {
  return value ? languagesByUrl.get(value.toLowerCase()) : undefined
}

export function localeFromPreferences(
  country: string | undefined,
  language: string | undefined,
  fallback: Locale
): Locale {
  return {
    countryCode:
      countryFromUrl(country) ?? countryCodeSchema.parse(fallback.countryCode),
    language:
      languageFromUrl(language) ?? languageSchema.parse(fallback.language)
  }
}

export function localePath(locale: Locale): string {
  return `/${locale.countryCode.toLowerCase()}/${locale.language.toLowerCase()}`
}

export function canonicalizeLocalePath(
  pathname: string,
  locale: Locale
): string {
  const segments = pathname.split('/')
  segments[1] = locale.countryCode.toLowerCase()
  segments[2] = locale.language.toLowerCase()
  return segments.join('/') || '/'
}
