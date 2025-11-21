import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    outDir: "dist",
    external: [
      "braintrust",
      "@opentelemetry/api",
      "@opentelemetry/core",
      "@opentelemetry/exporter-trace-otlp-http",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/context-async-hooks",
    ],
    dts: true,
  },
]);
