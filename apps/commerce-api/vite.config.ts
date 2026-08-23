import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: 'dist/server',
    ssr: 'src/server.ts',
    target: 'node22',
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'server.js'
      }
    }
  }
})
