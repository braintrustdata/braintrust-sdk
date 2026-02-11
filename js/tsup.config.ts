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
    external: ["zod"],
    noExternal: ["dc-browser", "als-browser"],
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
    entry: { cli: "src/cli/index.ts" },
    format: ["cjs"],
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
    entry: ["src/instrumentation/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist/instrumentation",
    external: ["dc-browser", "@braintrust/instrumentation-core", "zod"],
    dts: {
      compilerOptions: {
        skipLibCheck: true,
      },
    },
    splitting: false,
    clean: true,
  },
  {
    entry: [
      "src/auto-instrumentations/index.ts",
      "src/auto-instrumentations/loader/cjs-patch.ts",
      "src/auto-instrumentations/loader/get-package-version.ts",
      "src/auto-instrumentations/bundler/vite.ts",
      "src/auto-instrumentations/bundler/webpack.ts",
      "src/auto-instrumentations/bundler/esbuild.ts",
      "src/auto-instrumentations/bundler/rollup.ts",
    ],
    format: ["cjs", "esm"],
    outDir: "dist/auto-instrumentations",
    dts: true,
    external: ["@apm-js-collab/code-transformer", "zod"],
    outExtension({ format }) {
      if (format === "esm") {
        return { js: ".mjs" };
      }
      return { js: ".cjs" };
    },
    clean: true,
  },
  {
    entry: [
      "src/auto-instrumentations/hook.mts",
      "src/auto-instrumentations/loader/esm-hook.mts",
    ],
    format: ["esm"],
    outDir: "dist/auto-instrumentations",
    dts: false,
    external: ["@apm-js-collab/code-transformer", "zod"],
    outExtension({ format }) {
      return { js: ".mjs" };
    },
    clean: false,
  },
]);
