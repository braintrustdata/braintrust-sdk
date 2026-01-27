import { defineConfig } from "tsup";

export default defineConfig({
  // Build from browser-specific entry point that uses als-browser
  entry: ["./src/browser.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Bundle everything - no externals
  external: [],
  // Bundle all dependencies including als-browser
  noExternal: [/.*/],
  target: "es2022",
  platform: "browser",
  outDir: "./dist",
  treeshake: true,
});
