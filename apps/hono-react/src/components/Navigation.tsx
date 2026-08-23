import {
  COUNTRIES,
  LANGUAGES,
  type CountryCode,
  type Language
} from '@lesshub/commerce-contracts'
import { UserMenuSkeleton } from './UserMenuSkeleton.js'
import { NAVIGATION_VARIANT_PLACEHOLDER } from '../rendering/navigation-variant.js'

interface NavigationProps {
  countryCode: CountryCode
  language: Language
  variant?: string
}

const labels: Record<Language, { market: string; language: string }> = {
  'en-US': { market: 'Market', language: 'Language' },
  'ja-JP': { market: '市場', language: '言語' },
  'zh-CN': { market: '国家与市场', language: '语言' }
}

function localeHref(
  countryCode: CountryCode,
  language: Language,
  variant: string
): string {
  return `/${countryCode.toLowerCase()}/${language.toLowerCase()}/benchmark/${variant}/products`
}

export function Navigation({
  countryCode,
  language,
  variant = NAVIGATION_VARIANT_PLACEHOLDER
}: NavigationProps) {
  return (
    <nav
      className='site-navigation'
      data-fragment='navigation'
      aria-label='Primary'
    >
      <a
        className='wordmark'
        href={localeHref(countryCode, language, variant)}
        aria-label='Lesshub Field Supply home'
      >
        <span className='wordmark__index'>LH—26</span>
        <span className='wordmark__name'>Field Supply</span>
      </a>
      <div className='locale-switchers' aria-label='Locale preferences'>
        <div className='locale-switcher' aria-label='Country and currency'>
          <span className='locale-switcher__label'>{labels[language].market}</span>
          {COUNTRIES.map(country => (
            <a
              key={country}
              href={localeHref(country, language, variant)}
              aria-current={country === countryCode ? 'page' : undefined}
            >
              {country}
            </a>
          ))}
        </div>
        <div className='locale-switcher' aria-label='Language'>
          <span className='locale-switcher__label'>{labels[language].language}</span>
          {LANGUAGES.map(option => (
            <a
              key={option}
              href={localeHref(countryCode, option, variant)}
              aria-current={option === language ? 'page' : undefined}
            >
              {option}
            </a>
          ))}
        </div>
      </div>
      <UserMenuSkeleton />
    </nav>
  )
}
