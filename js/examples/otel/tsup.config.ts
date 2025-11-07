import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["nodesdk_example.ts"],
  format: ["cjs", "esm"],
  target: "node14",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  dts: false,
  noExternal: [/.*/],
});
