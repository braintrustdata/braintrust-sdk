import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "path";

const config = {
  plugins: [tsconfigPaths()],
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
    alias: {
      braintrust: resolve(__dirname, "../../dist/index.js"),
    },
  },
  test: {
    include: ["**/otel-no-deps.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    root: resolve(__dirname, "../.."),
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        isolate: true,
        execArgv: ["--no-warnings"],
      },
    },
  },
};
export default config;

