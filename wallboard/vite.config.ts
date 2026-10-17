import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone wallboard app (§4 Step 02). Reads the backend's events over HTTP;
// `/api/*` is proxied to the backend so `/api/events` hits `GET /events`.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
