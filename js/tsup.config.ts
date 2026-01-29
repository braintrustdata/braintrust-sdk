import { defineConfig } from "tsup";
import fs from "node:fs";
import { builtinModules } from "node:module";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    external: ["zod"],
    removeNodeProtocol: false,
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: true,
  },
  {
    entry: { cli: "src/cli/index.ts" },
    format: ["cjs"],
    removeNodeProtocol: false,
    outDir: "dist",
    external: ["esbuild", "prettier", "typescript", "zod"],
    // CLI doesn't need DTS
    dts: false,
    clean: false,
  },
  {
    entry: ["dev/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dev/dist",
    removeNodeProtocol: false,
    external: ["esbuild", "prettier", "typescript", "zod"],
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: true,
  },
  {
    entry: ["util/index.ts"],
    format: ["cjs", "esm"],
    outDir: "util/dist",
    external: ["esbuild", "prettier", "typescript", "zod"],
    removeNodeProtocol: false,
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: true,
  },
  // Browser/edge exports - single build used by browser, edge-light, and workerd
  {
    entry: {
      browser: "src/browser.ts",
    },
    format: ["cjs", "esm"],
    outDir: "dist",
    external: ["zod"],
    removeNodeProtocol: false,
    platform: "browser",
    splitting: false,
    dts: true,
    clean: false,
  },
]);
