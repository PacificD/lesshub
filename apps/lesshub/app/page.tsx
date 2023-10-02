import Link from 'next/link'
import { CopyButton } from '@ui/components/copy-button'
import { buttonVariants } from '@ui/components/button'
import { CONFIG } from '@/constants/config'
import Features from '@/components/features'

const RootPage = () => {
  return (
    <>
      <section className='container my-10 flex flex-1 flex-col items-center'>
        <div className='flex max-w-[980px] flex-col items-start space-y-5'>
          <h1 className='text-3xl font-extrabold leading-tight tracking-tighter sm:text-3xl md:text-5xl lg:text-6xl'>
            An example app built using Next.js 13 React server components.{' '}
            <br className='hidden sm:inline' />
            built with{' '}
            <span
              className='bg-gradient-to-r from-pink-500 via-red-500 to-yellow-500
 font-bold bg-clip-text text-4xl font-extrabold uppercase tracking-tighter text-transparent sm:text-5xl lg:text-7xl'
            >
              shadcn / ui
            </span>{' '}
            Components.
          </h1>

          <p className='max-w-[700px] text-lg text-neutral-700 dark:text-neutral-400 sm:text-xl'>
            I&apos;m building a web app with Next.js 13 and open sourcing
            everything. Follow along as we figure this out together.
          </p>

          <div className='flex w-full gap-4'>
            <Link
              href={CONFIG.repository}
              target='_blank'
              rel='noreferrer'
              className={buttonVariants({ size: 'lg' })}
            >
              GitHub
            </Link>

            <Link
              href={CONFIG.documentation}
              target='_blank'
              rel='noreferrer'
              className={buttonVariants({ size: 'lg', variant: 'outline' })}
            >
              Components
            </Link>

            <pre className='hidden h-11 items-center justify-between space-x-2 overflow-x-auto rounded-lg border border-neutral-100 bg-neutral-100 pl-6 pr-2 dark:border-neutral-700 dark:bg-black md:flex'>
              <code className='font-mono text-sm font-semibold text-neutral-900 dark:text-neutral-50'>
                {CONFIG.command}
              </code>
              <CopyButton
                value={CONFIG.command}
                className='border-none text-neutral-900 hover:bg-transparent dark:text-neutral-50'
              />
            </pre>
          </div>
        </div>
      </section>
      <Features />
    </>
  )
}

export default RootPage
