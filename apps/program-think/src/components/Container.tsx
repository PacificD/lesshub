import clsx from 'clsx'
import { ReactNode } from 'react'

export function Container({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={clsx(className, 'mx-auto max-w-2xl px-6 lg:max-w-4xl')}>
      {children}
    </div>
  )
}
