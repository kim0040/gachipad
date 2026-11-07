import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { thirdPartyLicenses } from "./scripts/third-party-licenses";

// The product version is the root package.json's; open tabs compare it with GET /api/version.
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  version: string;
};

// Ports are overridable so the end-to-end stack can run next to a normal dev stack.
const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiPort = process.env.API_PORT ?? "3001";
const collabPort = process.env.COLLAB_PORT ?? "3002";

export default defineConfig({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(version) },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    thirdPartyLicenses(),
    VitePWA({
      // A new build waits for the reload the update prompt offers. Only a page nobody is using, with no
      // document open in any tab, takes it by itself (lib/app-update.ts).
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "gachipad",
        short_name: "gachipad",
        description: "Real-time code sharing on your network",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0a0c13",
        theme_color: "#0a0c13",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // App shell, every route chunk and every lazily loaded language pack. Fonts are cached on
        // first use instead: the Hangul subsets alone are several hundred small files. Chunks that
        // are only imported on demand (the first-run tour, the guide texts in both languages)
        // are precached too, so the app and its guide work offline; a returning visitor
        // downloads them once per build when the service worker updates, even if never used.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/collab/,
          /^\/healthz/,
          /^\/metrics/,
          /^\/THIRD-PARTY-LICENSES\.txt$/,
          /^\/licenses\//,
        ],
        cleanupOutdatedCaches: true,
        importScripts: ["legacy-sw.js"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".woff2"),
            handler: "CacheFirst",
            options: {
              cacheName: "gachipad-fonts",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: webPort,
    strictPort: true,
    // As Caddy serves the app shell (deploy/caddy/Caddyfile).
    headers: { "Referrer-Policy": "no-referrer" },
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/collab": { target: `ws://localhost:${collabPort}`, ws: true },
    },
  },
  preview: { port: webPort, strictPort: true, headers: { "Referrer-Policy": "no-referrer" } },
  build: { target: "es2023", sourcemap: "hidden" },
});
