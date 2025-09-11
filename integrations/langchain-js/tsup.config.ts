import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    external: ["braintrust", "@langchain/core", "@langchain/langgraph"],
    dts: true,
  },
]);
