import tsconfigPaths from "vite-tsconfig-paths";

const config = {
  plugins: [tsconfigPaths()],
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
  },
  test: {
    // Set isolated mode to ensure dependencies aren't shared
    isolate: true,
    // Run setup file before tests to mock require() for OpenTelemetry packages
    setupFiles: ["./setup.ts"],
  },
};
export default config;
