import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  if (command === 'serve' && !env.ADMIN_API_TOKEN) {
    throw new Error(
      'ADMIN_API_TOKEN is required in customer-care-dashboard/.env.local for local API proxying.'
    )
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:8787',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyRequest) => {
              proxyRequest.setHeader(
                'Authorization',
                `Bearer ${env.ADMIN_API_TOKEN}`
              )
            })
          },
        },
      },
    },
  }
})
