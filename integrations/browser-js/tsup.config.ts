import { defineConfig } from "tsup";

export default defineConfig({
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
});
