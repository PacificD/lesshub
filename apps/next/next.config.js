/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['shadcn-ui'],
  experimental: {
    mdxRs: true
  },
  pageExtensions: ['md', 'tsx', 'ts', 'jsx', 'js', 'md', 'mdx']
}

const withMDX = require('@next/mdx')({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [],
    rehypePlugins: []
    // If you use `MDXProvider`, uncomment the following line.
    // providerImportSource: "@mdx-js/react",
  }
})
module.exports = withMDX(nextConfig)
