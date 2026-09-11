import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Сервис-воркер: сборка предкешируется, картинки карты берутся из кеша устройства (месяц), API не кешируется.
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      includeAssets: ["favicon.ico", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "manifest.webmanifest"],
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,ico,webmanifest}", "favicon-32.png", "icon-192.png", "apple-touch-icon.png", "img/brand/logo-64.png", "img/brand/logo-256.png"],
        runtimeCaching: [
          { urlPattern: /\/img\/.*\.(webp|png|jpg)$/, handler: "CacheFirst", options: { cacheName: "lotw-img", expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600 } } },
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//, handler: "StaleWhileRevalidate", options: { cacheName: "lotw-fonts", expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 3600 } } },
        ],
        // Обработчики push и клика по уведомлению — в public/push-sw.js.
        importScripts: ["push-sw.js"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
  build: { outDir: "dist", sourcemap: false },
});
