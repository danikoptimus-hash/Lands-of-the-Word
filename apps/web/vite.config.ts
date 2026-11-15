import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Метка сборки для картинок инструкции: имена файлов не меняются, а браузер кэширует их на 30 дней — параметр ?v= сбрасывает кэш при каждой выкладке.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  plugins: [
    react(),
    // Сервис-воркер: сборка предкешируется, картинки карты берутся из кеша устройства (месяц), API не кешируется.
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      includeAssets: ["favicon.ico", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "manifest.webmanifest"],
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,ico,webmanifest}", "favicon-32.png", "icon-192.png", "apple-touch-icon.png", "img/brand/logo-64.png", "img/brand/logo-256.png"],
        // Экраны и графики администратора платформы (ECharts, 618 КБ) игрокам не нужны: заранее они не качаются, а
        // загружаются, когда их откроют (ревизия скорости 15.11: раньше лежали в предзагрузке у каждого телефона).
        globIgnores: ["**/Chart-*.js", "**/AdminDashboard-*.js", "**/GameAnalytics-*.js"],
        runtimeCaching: [
          // Аватарки и гербы из готового набора (решение владельца 14.11) — в своём кэше, чтобы полтораста мелких картинок не вытесняли картинки карты.
          { urlPattern: /\/img\/(avatars|crests)\/.*\.webp(\?.*)?$/, handler: "CacheFirst", options: { cacheName: "lotw-avatars", expiration: { maxEntries: 320, maxAgeSeconds: 30 * 24 * 3600 } } },
          { urlPattern: /\/img\/.*\.(webp|png|jpg)(\?.*)?$/, handler: "CacheFirst", options: { cacheName: "lotw-img", expiration: { maxEntries: 240, maxAgeSeconds: 30 * 24 * 3600 } } },
          // Шрифты лежат рядом с сайтом (public/fonts) и не меняются: из памяти устройства, без запроса к серверу. Раньше они
          // перепроверялись при каждом запуске, и текст «перещёлкивался» с запасного шрифта (ревизия скорости 15.11).
          { urlPattern: /\/fonts\/.*\.woff2$/, handler: "CacheFirst", options: { cacheName: "lotw-fonts", expiration: { maxEntries: 30, maxAgeSeconds: 90 * 24 * 3600 } } },
          // Ленивые куски программы (их нет в предзагрузке): имя с меткой сборки, содержимое не меняется.
          { urlPattern: /\/assets\/.*\.js$/, handler: "CacheFirst", options: { cacheName: "lotw-chunks", expiration: { maxEntries: 12, maxAgeSeconds: 30 * 24 * 3600 } } },
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
