import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

const config = {
  plugins: [
    tsconfigPaths({
      root: ".",
      projects: ["./tsconfig.json"],
    }),
  ],
  resolve: {
    extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx", ".json"],
    alias: {
      vendor: false,
    },
  },
  server: {
    fs: {
      deny: [path.resolve(__dirname, "vendor")],
    },
  },
  optimizeDeps: {
    exclude: ["vendor/**"],
  },
  test: {
    // Don't exclude Zod tests - this config is specifically for running them
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
      "**/vendor/**",
      "vendor/**",
      "./vendor/**",
    ],
    watchExclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/vendor/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
  },
};
export default config;
