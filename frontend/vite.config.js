import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'
  const brandName = env.VITE_BRAND_NAME || 'NearMe Cab'

  return {
    plugins: [
      react(),
      VitePWA({
        // The app checks for a new service worker on every launch and swaps
        // itself out. Without this an installed app can pin a user to the
        // build they first installed, and a deploy never reaches them.
        registerType: 'autoUpdate',
        includeAssets: ['apple-touch-icon.png'],
        manifest: {
          name: brandName,
          short_name: brandName.split(' ')[0],
          description:
            'Book outstation cabs, airport transfers and local trips with a trusted local travel operator.',
          theme_color: '#151515',
          background_color: '#151515',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Single-page app: unmatched routes serve index.html from the cache
          // so a deep link like /admin/bookings works offline-first...
          navigateFallback: 'index.html',
          // ...but /api must never be answered from the cache. Bookings and
          // fares have to come from the server or fail honestly.
          navigateFallbackDenylist: [/^\/api/],
        },
        devOptions: {
          // Keep the service worker out of `npm run dev`; a stale cache during
          // development is far more confusing than it is useful.
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: { '@': path.resolve(process.cwd(), 'src') },
    },
    server: {
      port: 5173,
      // Same-origin in development so the httpOnly refresh cookie just works.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
          },
        },
      },
    },
  }
})
