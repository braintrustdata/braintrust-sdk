import { defineConfig } from "tsup";

export default defineConfig([
  // Main library
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: false,
    clean: true,
    splitting: false,
    sourcemap: true,
    outDir: "dist",
    target: "node16",
  },
  // CLI binary
  {
    entry: { "bin/braintrust-setup": "src/bin/braintrust-setup.ts" },
    format: ["cjs"],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: true,
    outDir: "dist",
    target: "node16",
    external: [], // Bundle everything for standalone CLI
    banner: {
      js: "#!/usr/bin/env node",
    },
    onSuccess: "chmod +x dist/bin/braintrust-setup.js",
  },
]);
