import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base keeps the build working on Cloudflare Pages (root or sub-path).
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4175 },
  build: { target: 'es2020' },
})
