import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "path";

// Resolve nunjucks browser build path
const nunjucksBrowserPath = path.resolve(
  process.cwd(),
  "node_modules/nunjucks/browser/nunjucks.js",
);

export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    // Alias is required - isWorkerEnvironment() only detects/warns, it doesn't change imports
    // This alias redirects all 'nunjucks' references to the browser build
    alias: {
      nunjucks: nunjucksBrowserPath,
    },
  },
});
