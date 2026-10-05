import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * base path:
 *  - GitHub Pages project site (https://user.github.io/repo/) => set VITE_BASE_PATH=/repo/
 *  - user/organization page (https://user.github.io/) or custom domain => '/'
 * Defaults to '/' and is overridden in CI via workflow env.
 */
const base = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'نظام إدارة المخبز',
        short_name: 'المخبز',
        description: 'نظام تشغيل رقمي متكامل لإدارة المخبز: مبيعات، مشتريات، إنتاج، مخزون، توزيع، حسابات',
        dir: 'rtl',
        lang: 'ar',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        background_color: '#fafaf9',
        theme_color: '#b45309',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/icons\//],
        runtimeCaching: [
          {
            // Supabase REST/Auth calls are NEVER cached (sensitive data)
            urlPattern: /^https:\/\/.*\.supabase\.(co|in)\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          data: ['@supabase/supabase-js', 'dexie', '@tanstack/react-query'],
        },
      },
    },
  },
  server: { port: 5173, host: true },
})
