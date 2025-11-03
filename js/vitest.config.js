import tsconfigPaths from "vite-tsconfig-paths";

const config = {
  plugins: [tsconfigPaths()],
  // Prefer TypeScript over JavaScript for extension-less imports in sdk/js tests
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
  },
  test: {
    exclude: [
      // Default vitest exclusions
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      // Exclude subdirectories with their own test configs
      "src/wrappers/ai-sdk-4/**",
      "src/wrappers/ai-sdk-5/**",
      "src/wrappers/mastra/**",
      "src/wrappers/claude-agent-sdk/**",
      // Exclude otel tests (run separately with test:otel and test:otel-no-deps)
      "src/otel/**",
      "src/otel-no-deps.test.ts",
    ],
  },
};
export default config;
