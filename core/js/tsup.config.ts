import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    external: ["zod"],
    dts: true,
  },
  {
    entry: ["typespecs/index.ts"],
    format: ["cjs", "esm"],
    outDir: "typespecs/dist",
    external: ["zod"],
    dts: true,
  },
]);
