import { defineConfig } from "tsup";

const esmNodeSupportBanner = {
  js: `
import { createRequire as topLevelCreateRequire } from 'module';
const require = topLevelCreateRequire(import.meta.url);`,
};

export default defineConfig(() => {
  return [
    {
      entry: ["src/index.ts"],
      format: ["esm"],
      outDir: "dist",
      external: ["zod"],
      dts: {
        // Split DTS generation to reduce memory usage
        compilerOptions: {
          skipLibCheck: true,
        },
      },
      banner: esmNodeSupportBanner,
      splitting: true,
      clean: true,
    },
    {
      entry: ["src/index.ts"],
      format: ["cjs"],
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
      format: ["esm"],
      outDir: "dist",
      dts: {
        // Split DTS generation to reduce memory usage
        compilerOptions: {
          skipLibCheck: true,
        },
      },
      banner: esmNodeSupportBanner,
      splitting: true,
      clean: false,
    },
    {
      entry: ["src/browser.ts"],
      format: ["cjs"],
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
      format: ["esm"],
      outDir: "dev/dist",
      external: ["esbuild", "prettier", "typescript"],
      dts: {
        // Split DTS generation to reduce memory usage
        compilerOptions: {
          skipLibCheck: true,
        },
      },
      banner: esmNodeSupportBanner,
      splitting: true,
      clean: true,
    },
    {
      entry: ["dev/index.ts"],
      format: ["cjs"],
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
      format: ["esm"],
      outDir: "util/dist",
      external: ["esbuild", "prettier", "typescript"],
      dts: {
        // Split DTS generation to reduce memory usage
        compilerOptions: {
          skipLibCheck: true,
        },
      },
      banner: esmNodeSupportBanner,
      splitting: true,
      clean: true,
    },
    {
      entry: ["util/index.ts"],
      format: ["cjs"],
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
  ];
});
