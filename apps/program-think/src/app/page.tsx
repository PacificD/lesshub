import { PostCard } from '@/components/PostCard'
import { Button } from '@ui/components/button'
import { allPosts } from 'contentlayer/generated'
import { compareDesc } from 'date-fns'
import { Github } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  const posts = allPosts.sort((a, b) =>
    compareDesc(new Date(a.date), new Date(b.date))
  )

  return (
    <div>
      <div className='space-y-7'>
        <h1>Program think 编程随想</h1>
        <p>Built with:</p>
        <ul className='my-6 list-disc space-y-2 pl-4'>
          <li>
            <Link className='link' href='https://nextjs.org/docs/app'>
              Next.js - App Router
            </Link>
          </li>
          <li>
            <Link className='link' href='https://www.contentlayer.dev/'>
              Contentlayer
            </Link>
          </li>
          <li>
            <Link className='link' href='https://mdxjs.com/'>
              MDX
            </Link>
          </li>
          <li>
            <Link className='link' href='https://ui.shadcn.com/'>
              shadcn-ui
            </Link>
          </li>
          <li>
            <Link className='link' href='https://tailwindcss.com/'>
              Tailwind CSS
            </Link>
          </li>
        </ul>

        <Button asChild>
          <a href='https://github.com'>
            <Github className='mr-1' /> Github!
          </a>
        </Button>
      </div>

      <div className='mt-10 space-y-12 border-t border-gray-200 pt-10 dark:border-gray-700'>
        {posts.map((post, idx) => (
          <PostCard key={idx} {...post} />
        ))}
      </div>
    </div>
  )
}
