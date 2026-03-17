import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

const config = {
  plugins: [
    tsconfigPaths({
      // Explicitly specify the root tsconfig to prevent scanning vendor folders
      root: ".",
      projects: ["./tsconfig.json"],
    }),
  ],
  // Prefer TypeScript over JavaScript for extension-less imports in sdk/js tests
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
    alias: {
      // Prevent resolution into vendor directories
      vendor: false,
      // Alias @braintrust/browser bundler subpaths to source files to avoid a
      // circular workspace dependency (braintrust -> @braintrust/browser -> braintrust).
      "@braintrust/browser/esbuild": path.resolve(
        __dirname,
        "../integrations/browser-js/src/bundler/esbuild.ts",
      ),
      "@braintrust/browser/vite": path.resolve(
        __dirname,
        "../integrations/browser-js/src/bundler/vite.ts",
      ),
      "@braintrust/browser/rollup": path.resolve(
        __dirname,
        "../integrations/browser-js/src/bundler/rollup.ts",
      ),
      // Redirect braintrust subpath import used by the browser bundler plugin to the
      // workspace source, bypassing the stale npm v3.0.0-rc.29 copy in
      // integrations/browser-js/node_modules (which predates this export).
      "braintrust/auto-instrumentation-configs": path.resolve(
        __dirname,
        "src/auto-instrumentations/index.ts",
      ),
    },
  },
  server: {
    fs: {
      // Deny access to vendor folder
      deny: [path.resolve(__dirname, "vendor")],
    },
  },
  optimizeDeps: {
    exclude: ["vendor/**"],
  },
  test: {
    exclude: [
      // Default vitest exclusions
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      // Exclude vendor folder and all its contents
      "**/vendor/**",
      "vendor/**",
      "./vendor/**",
      // Exclude subdirectories with their own test configs
      "src/wrappers/ai-sdk/**",
      "src/wrappers/claude-agent-sdk/**",
      "src/wrappers/vitest/**",
      "smoke/**",
      // Exclude example tests (require API keys and make real API calls)
      "examples/vitest/**",
      "examples/node-test/**",
    ],
    // Additional test environment configuration
    watchExclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/vendor/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
    testTimeout: 15_000,
  },
};
export default config;
