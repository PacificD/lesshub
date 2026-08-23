import type { CountryCode, Language } from '@lesshub/commerce-contracts'

interface FooterProps {
  countryCode: CountryCode
  language: Language
}

const footerCopy: Record<Language, string> = {
  'en-US': 'Objects for field notes, working desks, and lasting archives.',
  'ja-JP': 'フィールドノート、仕事机、長く残るアーカイブのための道具。',
  'zh-CN': '为野外记录、工作桌面与长久档案而选的物件。'
}

export function Footer({ countryCode, language }: FooterProps) {
  return (
    <footer className='site-footer' data-fragment='footer'>
      <p>{footerCopy[language]}</p>
      <p className='site-footer__meta'>
        Market {countryCode} · Language {language} · Lesshub 2026
      </p>
    </footer>
  )
}
