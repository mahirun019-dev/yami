import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ".", "");
  const base = command === "build"
    ? (env.VITE_PAGES_BASE || "/yami/").replace(/\/?$/, "/")
    : "/";
  const cacheId = base === "/todo-apple-mobile/"
    ? "yami-legacy-todo-apple-mobile-v1"
    : "yami-yami-brand-avatar-v1";

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"],
        manifest: {
          name: "Yami",
          short_name: "Yami",
          id: base,
          lang: "zh-CN",
          description: "A focused workspace for Japanese job hunting.",
          theme_color: "#f7f7f8",
          background_color: "#f7f7f8",
          display: "standalone",
          orientation: "portrait-primary",
          start_url: base,
          scope: base,
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          cacheId,
          globIgnores: [
            "**/yami-app-icon-180-v*.png",
            "**/yami-app-icon-192-v*.png",
            "**/yami-app-icon-512-v*.png",
            "**/yami-app-icon-maskable-512-v*.png",
            "**/yami-app-icon-v*.svg",
            "**/yami-app-icon-avatar-180-v*.png",
            "**/yami-app-icon-avatar-192-v*.png",
            "**/yami-app-icon-avatar-512-v*.png",
            "**/yami-app-icon-avatar-maskable-512-v*.png",
            "**/yami-favicon-32-v*.png",
            "**/yami-favicon-v*.ico",
            "**/yami-favicon-v*.svg",
            "**/yami-mask-icon-v*.svg",
            "**/yami-mark-v*.svg",
          ],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          navigateFallback: "index.html",
          navigateFallbackDenylist: [
            /^\/[^/]+\/404\.html$/,
          ],
        },
      }),
    ],
  };
});
