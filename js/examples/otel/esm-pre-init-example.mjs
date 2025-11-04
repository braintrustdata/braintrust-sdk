#!/usr/bin/env node
/**
 * Example: Pre-initializing OpenTelemetry in ESM environments
 *
 * This demonstrates how to use Braintrust OTEL features in pure ESM environments
 * where async loading is not possible.
 *
 * Run with:
 *   - Node.js (ESM): node examples/otel/esm-pre-init-example.mjs
 *   - TypeScript (with tsx): tsx examples/otel/esm-pre-init-example.mjs
 *
 * Note: For TypeScript development, you can also use the .ts version or
 * run this .mjs file directly with tsx which supports ESM.
 */

// Step 1: Import OpenTelemetry packages at the top level
import * as api from "@opentelemetry/api";
import * as sdk from "@opentelemetry/sdk-trace-base";
import * as exporter from "@opentelemetry/exporter-trace-otlp-http";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";

// Step 2: Import Braintrust and pre-initialize OTEL
// This import works for both compiled JavaScript (dist/index.js) and TypeScript (with tsx)
// For TypeScript development, tsx will resolve the import correctly
// For production, use the compiled output: ../../dist/index.js
import {
  preInitializeOtel,
  BraintrustSpanProcessor,
} from "../../dist/index.js";

// Step 3: Pre-initialize OTEL before using Braintrust OTEL features
// In ESM, this must be awaited
await preInitializeOtel(api, sdk, exporter);

// Step 4: Now you can use Braintrust OTEL features
async function main() {
  // Set your API key
  process.env.BRAINTRUST_API_KEY =
    process.env.BRAINTRUST_API_KEY || "your-api-key";

  // Create Braintrust span processor
  const processor = new BraintrustSpanProcessor({
    apiKey: process.env.BRAINTRUST_API_KEY,
    parent: "project_name:esm-example",
  });

  // Setup OpenTelemetry with Braintrust processor
  const provider = new BasicTracerProvider({
    spanProcessors: [processor],
  });

  api.trace.setGlobalTracerProvider(provider);
  const tracer = api.trace.getTracer("esm-example");

  // Use OTEL tracing
  await tracer.startActiveSpan("esm-operation", async (span) => {
    span.setAttribute("environment", "esm");
    span.setAttribute("module_type", "esm");

    // Your application logic here
    console.log("Running in ESM environment with pre-initialized OTEL");

    span.end();
  });

  // Cleanup
  await provider.shutdown();
}

main().catch(console.error);
