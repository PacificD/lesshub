import React from 'react'
import { Bot, Code2, Upload } from 'lucide-react'
import Link from 'next/link'

type Feature = {
  icon: any
  title: string
  desc: string
  link: string
}

const featureList: Array<Feature> = [
  {
    icon: <Code2 className='h-12 w-12' />,
    title: 'program think',
    desc: 'Share through my experience and everything I&apos;m learning',
    link: 'https://use-program-think.vercel.app'
  },
  {
    icon: <Upload className='h-12 w-12' />,
    title: 'less-uploadthing',
    desc: 'Effortlessly upload media with uploadthing',
    link: '/upload'
  },
  {
    icon: <Bot className='h-12 w-12' />,
    title: 'chatgpt-next',
    desc: 'Personally deployed cross-platform ChatGPT web UI.',
    link: 'https://use-chatgpt.vercel.app'
  }
]

const Features = () => {
  return (
    <section
      id='features'
      className='container space-y-6 bg-slate-50 py-8 dark:bg-transparent md:py-12 lg:py-24'
    >
      <div className='mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center'>
        <h2 className='font-bold text-2xl tracking-tighter sm:text-3xl md:text-6xl'>
          Features
        </h2>
        <p className='max-w-[85%] leading-normal text-muted-foreground sm:text-lg sm:leading-7'>
          This project is an experiment to see how a modern app, with features
          like auth, subscriptions, API routes, and static pages would work in
          Next.js 13 app dir.
        </p>
      </div>
      <div className='mx-auto grid justify-center gap-4 sm:grid-cols-2 md:max-w-[64rem] md:grid-cols-3'>
        {featureList.map(feature => (
          <Link
            href={feature.link}
            key={feature.title}
            className='relative overflow-hidden rounded-lg border bg-background p-2'
          >
            <div className='flex h-[180px] flex-col justify-between rounded-md p-6'>
              {feature.icon}
              <div className='space-y-2'>
                <h3 className='font-bold'>{feature.title}</h3>
                <p className='text-sm text-muted-foreground'>{feature.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default Features
