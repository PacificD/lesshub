import Link from 'next/link'
import { Button } from '@ui/components/button'

const NotFoundPage = () => {
  return (
    <section>
      <div className='py-8 px-4 mx-auto max-w-screen-xl lg:py-16 lg:px-6'>
        <div className='mx-auto max-w-screen-sm text-center'>
          <h1 className='bg-gradient-to-r from-sky-400 via-rose-400 to-lime-400 bg-clip-text text-transparent mb-4 text-7xl tracking-tight font-extrabold lg:text-9xl text-primary-600 dark:text-primary-500'>
            404
          </h1>
          <p className='mb-4 text-3xl tracking-tight font-bold text-gray-700 md:text-4xl dark:text-gray-200'>
            Page not found
          </p>
          <p className='mb-4 text-lg font-light text-gray-500 dark:text-gray-400'>
            Sorry, we can&apos;t find that page. You&apos;ll find lots to
            explore on the home page.{' '}
          </p>
          <Button size='lg' className='text-lg font-bold mt-2'>
            <Link href='/'>Back to Homepage</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

export default NotFoundPage
