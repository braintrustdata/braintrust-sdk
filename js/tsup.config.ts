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
  // {
  //   entry: ["edge/index.ts"],
  //   format: ["cjs", "esm"],
  //   outDir: "edge/dist",
  //   dts: true,
  // },
  // {
  //   entry: ["schema/index.ts"],
  //   format: ["cjs", "esm"],
  //   outDir: "schema/dist",
  //   dts: true,
  // },
]);
