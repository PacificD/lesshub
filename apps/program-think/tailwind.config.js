/** @type {import('tailwindcss').Config} */
const shadcn = require('ui/tailwind.config')
module.exports = {
  ...shadcn,
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/components/**/*.{ts,tsx}'
  ],
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')]
}
