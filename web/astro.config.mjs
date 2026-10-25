// Static site: every page is pre-built HTML; search runs in the browser. No server code.
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "auto" },
  compressHTML: true,
  redirects: { "/people": "/topics/#people", "/places": "/topics/#places", "/numbers": "/letters/#numbers" },
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  vite: {
    worker: { format: "es" },
    // Older iPads/iPhones (Safari 13+) must be able to run the search code.
    build: { chunkSizeWarningLimit: 800, target: "safari13" },
  },
});
