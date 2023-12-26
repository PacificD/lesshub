import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src'],
  outDir: 'dist',
  target: 'es2015',
  format: ['esm'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: true,
  treeshake: true
})
