import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    external: [
      "zod",
      "@opentelemetry/api",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/exporter-trace-otlp-http",
    ],
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
    external: [
      "@opentelemetry/api",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/exporter-trace-otlp-http",
    ],
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
    external: [
      "esbuild",
      "prettier",
      "typescript",
      "@opentelemetry/api",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/exporter-trace-otlp-http",
    ],
    // CLI doesn't need DTS
    dts: false,
    clean: false,
  },
  {
    entry: ["dev/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dev/dist",
    external: [
      "esbuild",
      "prettier",
      "typescript",
      "@opentelemetry/api",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/exporter-trace-otlp-http",
    ],
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
    external: [
      "esbuild",
      "prettier",
      "typescript",
      "@opentelemetry/api",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/exporter-trace-otlp-http",
    ],
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
