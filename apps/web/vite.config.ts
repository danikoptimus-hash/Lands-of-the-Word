import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Версия картинок карты — хеш содержимого public/img (местность, города, старты, островки). Имена файлов не меняются,
 * а браузер и сервис-воркер держат их месяц: без параметра ?v= после замены текстур показывалась старая копия из кеша
 * (06.10: на стенде ещё месяц сидели бы текстуры из отменённой ветки сезонов). Меняется только когда меняются файлы.
 */
function imgVersion(): string {
  const h = createHash("md5");
  const walk = (dir: string) => { for (const f of readdirSync(dir).sort()) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else { h.update(p); h.update(readFileSync(p)); } } };
  for (const d of ["terrain", "city", "start", "islet"]) { try { walk(join(__dirname, "public", "img", d)); } catch { /* каталога может не быть в тестах */ } }
  return h.digest("hex").slice(0, 10);
}

export default defineConfig({
  // Метка сборки для картинок инструкции: имена файлов не меняются, а браузер кэширует их на 30 дней — параметр ?v= сбрасывает кэш при каждой выкладке.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)), __IMG_VERSION__: JSON.stringify(imgVersion()) },
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
          { urlPattern: /\/img\/.*\.(webp|png|jpg)(\?.*)?$/, handler: "CacheFirst", options: { cacheName: "lotw-img", expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 3600 } } },
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
