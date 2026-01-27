import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["braintrust", "zod"], // Don't bundle peer dependencies
  noExternal: ["als-browser"], // Force bundle als-browser
  target: "es2022",
  platform: "browser",
  outDir: "./dist",
  treeshake: true,
});
