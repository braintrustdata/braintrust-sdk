import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/register.ts"],
  format: ["esm"],
  outDir: "dist",
  external: ["braintrust", "import-in-the-middle"],
  dts: true,
  clean: true,
});
