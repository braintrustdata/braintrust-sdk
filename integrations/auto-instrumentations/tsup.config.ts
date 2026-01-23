import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/hook.mts",
      "src/loader/esm-hook.mts",
      "src/loader/cjs-patch.ts",
      "src/loader/get-package-version.ts",
      "src/bundler/vite.ts",
      "src/bundler/webpack.ts",
      "src/bundler/esbuild.ts",
      "src/bundler/rollup.ts",
    ],
    format: ["cjs", "esm"],
    outDir: "dist",
    dts: true,
    external: [
      "braintrust",
      "@apm-js-collab/code-transformer",
      "@apm-js-collab/code-transformer-bundler-plugins",
    ],
    outExtension({ format }) {
      if (format === "esm") {
        return { js: ".mjs" };
      }
      return { js: ".cjs" };
    },
  },
]);
