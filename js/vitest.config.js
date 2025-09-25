import tsconfigPaths from "vite-tsconfig-paths";

const config = {
  plugins: [tsconfigPaths()],
  // Prefer TypeScript over JavaScript for extension-less imports in sdk/js tests
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
  },
};
export default config;
