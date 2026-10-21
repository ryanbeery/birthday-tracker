import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // For `npm run dev` outside Docker: send API calls to the local API so the
    // browser stays on one origin, the same job nginx does inside Docker.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
