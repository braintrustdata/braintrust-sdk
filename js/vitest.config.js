import tsconfigPaths from "vite-tsconfig-paths";

const config = {
  plugins: [tsconfigPaths()],
  // Prefer TypeScript over JavaScript for extension-less imports in sdk/js tests
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "src/wrappers/ai-sdk-4/**",
      "src/wrappers/ai-sdk-5/**",
      "src/wrappers/mastra/**",
      "src/wrappers/claude-agent-sdk/**",
    ],
  },
};
export default config;
