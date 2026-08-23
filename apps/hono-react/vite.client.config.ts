import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  build: {
    emptyOutDir: false,
    outDir: 'dist/client',
    manifest: true,
    rollupOptions: {
      input: {
        global: 'src/styles/global.css',
        'user-menu': 'src/client/user-menu.tsx',
        'product-list': 'src/client/product-list.tsx'
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
})
