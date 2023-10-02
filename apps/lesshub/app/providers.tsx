'use client'
import { ReactNode } from 'react'
import { ThemeProvider } from 'next-themes'
import { EdgeStoreProvider } from '@/lib/edgestore'

type ProvidersProps = {
  children: ReactNode
}

export const Providers = ({ children }: ProvidersProps) => {
  return (
    <ThemeProvider attribute='class' defaultTheme='system' enableSystem>
      <EdgeStoreProvider>{children}</EdgeStoreProvider>
    </ThemeProvider>
  )
}
