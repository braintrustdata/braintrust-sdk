import { defineConfig } from "tsup";
export default defineConfig({
  entry: {
    index: "src/index.ts",
    encoder: "src/encoder.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  shims: true,
  clean: true,
  external: ["@audio/encode-opus"],
});
