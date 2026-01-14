import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      register: "src/register.ts",
    },
    format: ["cjs", "esm"],
    outDir: "dist",
    external: ["braintrust", "import-in-the-middle"],
    dts: true,
    clean: true,
  },
]);
