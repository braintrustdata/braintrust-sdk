import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["braintrust", "zod"],
    target: "es2022",
    platform: "browser",
    outDir: "./dist",
    treeshake: true,
  },
  {
    entry: {
      "bundler/vite": "src/bundler/vite.ts",
      "bundler/webpack": "src/bundler/webpack.ts",
      "bundler/esbuild": "src/bundler/esbuild.ts",
      "bundler/rollup": "src/bundler/rollup.ts",
    },
    format: ["esm"],
    dts: true,
    platform: "node",
    external: ["braintrust", "@apm-js-collab/code-transformer", "zod"],
    outDir: "./dist",
    clean: false,
  },
]);
