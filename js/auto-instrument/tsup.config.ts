import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    register: "src/register.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  outDir: "dist",
  target: "node18",
  external: ["braintrust", "import-in-the-middle"],
});
