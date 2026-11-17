import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, loadEnv } from "vite";

// package.json is the single source of the app version (bumped by `/publish`).
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const isAnalyze = mode === "analyze";

  return {
    plugins: [
      react(),
      tailwindcss(),
      // `npm run build:analyze` → writes dist/stats.html and opens it
      isAnalyze &&
        visualizer({
          filename: "dist/stats.html",
          open: true,
          gzipSize: true,
          brotliSize: true,
        }),
    ].filter(Boolean),
    define: {
      // Read in app code as import.meta.env.APP_VERSION (e.g. the Sentry release tag).
      "import.meta.env.APP_VERSION": JSON.stringify(version),
      // Prefix for every browser-storage key (`${VITE_STORE_KEY}-admin-auth`, …) so
      // two apps built from this template on one origin never share a session.
      // Defined here so the fallback also reaches `%VITE_STORE_KEY%` in index.html.
      "import.meta.env.VITE_STORE_KEY": JSON.stringify(
        env.VITE_STORE_KEY || "app",
      ),
    },
    resolve: {
      alias: {
        // shadcn/ui components import via `@/…`; also usable in app code.
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      host: true,
      port: 4020,
      strictPort: true,
      proxy: {
        "/api/v1": {
          target: env.VITE_API_URL,
          changeOrigin: true,
          secure: false,
        },
        "/public/uploads": {
          target: env.VITE_API_URL,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      // Enable code splitting
      rolldownOptions: {
        output: {
          codeSplitting: {
            // Vendor chunks for better caching
            groups: [
              {
                name: "react-vendor",
                test: /[\\/]node_modules[\\/](react|react-dom|react-router)[\\/]/,
              },
              {
                name: "query-vendor",
                test: /[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
              },
              {
                name: "utils-vendor",
                test: /[\\/]node_modules[\\/](axios|dayjs|zustand)[\\/]/,
              },
            ],
          },
        },
      },
      // Chunk size warnings
      chunkSizeWarningLimit: 1000,
      // "hidden" emits .map files WITHOUT the //# sourceMappingURL comment, so
      // production stack traces are resolvable after uploading the maps to
      // Sentry, but the maps are never advertised to (or fetched by) browsers.
      // Upload dist/**/*.map to Sentry in CI, then delete them before serving.
      sourcemap: mode === "development" ? true : "hidden",
    },
    optimizeDeps: {
      // Pre-bundle dependencies for faster dev server
      include: [
        "react",
        "react-dom",
        "react-router",
        "@tanstack/react-query",
        "axios",
        "dayjs",
        "zustand",
        "clsx",
      ],
    },
  };
});
