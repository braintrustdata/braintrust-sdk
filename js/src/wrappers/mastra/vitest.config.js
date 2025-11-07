import tsconfigPaths from "vite-tsconfig-paths";

const config = {
  plugins: [tsconfigPaths()],
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
  },
  test: {
    deps: {
      inline: ['@ai-sdk/openai', 'ai', '@mastra/core'],
    },
  },
};
export default config;
