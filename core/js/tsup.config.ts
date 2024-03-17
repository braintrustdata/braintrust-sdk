import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    dts: true,
  },
  {
    entry: ["typespecs/index.ts"],
    format: ["cjs", "esm"],
    outDir: "typespecs/dist",
    dts: true,
  },
  {
    entry: ["typespecs/index.ts"],
    format: ["cjs", "esm"],
    outDir: "typespecs-stainless/dist",
    dts: true,
    env: {
      BRAINTRUST_TYPESPECS_MODE: "stainless",
    },
  },
]);
