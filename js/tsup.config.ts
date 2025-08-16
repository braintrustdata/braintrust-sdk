import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    // Mark OpenTelemetry packages as external to prevent bundling.
    // This allows users to install their own version of OpenTelemetry
    // and ensures version compatibility with their applications.
    external: [
      "zod",
      "@opentelemetry/api",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/exporter-trace-otlp-http",
      "@opentelemetry/resources",
      "@opentelemetry/semantic-conventions",
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
    // OpenTelemetry packages marked as external (though not used in browser build)
    external: [
      "@opentelemetry/api",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/exporter-trace-otlp-http",
      "@opentelemetry/resources",
      "@opentelemetry/semantic-conventions",
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
      "@opentelemetry/resources",
      "@opentelemetry/semantic-conventions",
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
      "@opentelemetry/resources",
      "@opentelemetry/semantic-conventions",
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
