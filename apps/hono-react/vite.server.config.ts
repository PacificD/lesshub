import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
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
