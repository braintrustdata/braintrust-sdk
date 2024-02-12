import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist/main",
    dts: true,
  },
  {
    entry: ["src/typespecs/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist/typespecs",
    dts: true,
  },
  {
    entry: ["src/typespecs/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist/typespecs-stainless",
    dts: true,
    env: {
      BRAINTRUST_TYPESPECS_MODE: "stainless",
    },
  },
]);
