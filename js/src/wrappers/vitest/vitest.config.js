import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

const config = {
  plugins: [
    tsconfigPaths({
      root: __dirname,
      projects: [path.resolve(__dirname, "tsconfig.json")],
      ignoreConfigErrors: true,
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
      deny: [path.resolve(__dirname, "../../../vendor"), "**/vendor/**"],
    },
  },
  optimizeDeps: {
    exclude: ["vendor/**", "**/vendor/**"],
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
      "../../../vendor/**",
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
