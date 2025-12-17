import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  outDir: "dist",
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  // No external dependencies to bundle - this is a standalone test utility package
});
