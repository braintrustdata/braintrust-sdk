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
      "src/wrappers/mastra/**",
      "src/wrappers/claude-agent-sdk/**",
    ],
    // Additional test environment configuration
    watchExclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/vendor/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
  },
};
export default config;
