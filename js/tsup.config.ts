import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    dts: true,
  },
  {
    entry: ["src/browser.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    dts: true,
  },
  {
    entry: ["src/cli.ts"],
    format: ["cjs"],
    outDir: "dist",
    external: ["esbuild"],
  },
  {
    entry: ["ai-sdk/index.ts"],
    format: ["cjs", "esm"],
    outDir: "ai-sdk/dist",
    dts: true,
  },
]);
