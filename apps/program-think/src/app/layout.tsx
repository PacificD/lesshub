import React from 'react'
import { Analytics } from '@vercel/analytics/react'
import { ThemeProvider } from '@/app/providers'
import { Container } from '@/components/Container'
import { Navigation } from '@/components/Navigation'
import ThemeSwitch from '@/components/ThemeSwitch'
import { WEBSITE_HOST_URL } from '@/lib/constants'
import type { Metadata } from 'next'
import Link from 'next/link'
import './global.css'

const meta = {
  title: 'Program think',
  description: 'Program think 编程随想',
  image: `${WEBSITE_HOST_URL}/og-preview.jpg`
}

export const metadata: Metadata = {
  title: {
    default: meta.title,
    template: '%s | Program think'
  },
  description: meta.description,
  openGraph: {
    title: meta.title,
    description: meta.description,
    url: WEBSITE_HOST_URL,
    siteName: meta.title,
    locale: 'en-US',
    type: 'website',
    images: [
      {
        url: meta.image
      }
    ]
  },
  twitter: {
    title: meta.title,
    description: meta.description,
    images: meta.image,
    card: 'summary_large_image'
  },
  alternates: {
    canonical: WEBSITE_HOST_URL
  }
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang='en'>
      <body>
        <ThemeProvider attribute='class' defaultTheme='dark'>
          <header className='py-4'>
            <Container>
              <div className='flex items-center justify-between py-6'>
                <Navigation />
                <ThemeSwitch />
              </div>
            </Container>
          </header>
          <main>
            <Container>{children}</Container>
          </main>
          <footer className='py-16'>
            <Container>
              <p>
                Built with{' '}
                <Link className='link' href='https://nextjs.org'>
                  Next.js
                </Link>
              </p>
            </Container>
          </footer>
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
