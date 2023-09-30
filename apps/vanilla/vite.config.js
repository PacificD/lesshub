// vite.config.js
import { defineConfig } from 'vite'
import path from 'path'
// const path = require('path')

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  plugins: []
})
