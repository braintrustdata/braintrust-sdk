import tsconfigPaths from "vite-tsconfig-paths";

const config = {
  plugins: [tsconfigPaths()],
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
  },
};
export default config;
