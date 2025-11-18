import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    external: ["zod"],
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
    entry: ["src/browser.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: false,
  },
  {
    entry: ["src/cli.ts"],
    format: ["cjs"],
    outDir: "dist",
    external: ["esbuild", "prettier", "typescript"],
    // CLI doesn't need DTS
    dts: false,
    clean: false,
  },
  {
    entry: ["dev/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dev/dist",
    external: ["esbuild", "prettier", "typescript"],
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
    external: ["esbuild", "prettier", "typescript"],
    dts: {
      // Split DTS generation to reduce memory usage
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: true,
    clean: true,
  },
]);
