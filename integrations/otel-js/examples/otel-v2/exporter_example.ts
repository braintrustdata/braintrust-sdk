/**
 * OpenTelemetry v2.x example using BraintrustExporter
 *
 * This example demonstrates how to use BraintrustExporter, which is an OTLP-compatible
 * exporter that can be used with standard OpenTelemetry span processors.
 *
 * Key differences from BraintrustSpanProcessor:
 * - BraintrustExporter is a lower-level exporter that implements the SpanExporter interface
 * - It can be used with any OpenTelemetry span processor (BatchSpanProcessor, SimpleSpanProcessor, etc.)
 * - Useful when you want more control over the processor configuration
 *
 * Requirements:
 * - @opentelemetry/sdk-node
 * - @opentelemetry/sdk-trace-base
 * - @braintrust/otel
 *
 * Run with: npx tsx exporter_example.ts
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BraintrustExporter } from "@braintrust/otel";
import { trace } from "@opentelemetry/api";

// Create BraintrustExporter - this is an OTLP-compatible exporter
// that can be used with standard OpenTelemetry span processors
const exporter = new BraintrustExporter({
  parent: "project_name:otel-v2-examples",
  filterAISpans: true,
});

// Option 1: Use BatchSpanProcessor (recommended for production)
// BatchSpanProcessor batches spans before exporting, which is more efficient
// Type assertion needed for OTel version compatibility
const batchProcessor = new BatchSpanProcessor(exporter);

// Option 2: Use SimpleSpanProcessor (useful for debugging)
// SimpleSpanProcessor exports spans immediately, one at a time
// Uncomment to use instead:
// const simpleProcessor = new SimpleSpanProcessor(exporter);

const sdk = new NodeSDK({
  spanProcessors: [batchProcessor],
});

sdk.start();

console.log("OpenTelemetry v2.x NodeSDK started with BraintrustExporter");
console.log("BRAINTRUST_API_KEY set:", !!process.env.BRAINTRUST_API_KEY);
console.log("OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY);

const tracer = trace.getTracer("exporter-example-service", "1.0.0");

async function makeRequest() {
  return tracer.startActiveSpan("exporter.example", async (rootSpan) => {
    rootSpan.setAttributes({
      "user.request": "exporter_demo",
      "request.timestamp": new Date().toISOString(),
    });

    // This span will be kept by the filter (gen_ai prefix)
    await tracer.startActiveSpan("gen_ai.chat.completions", async (aiSpan) => {
      aiSpan.setAttributes({
        "gen_ai.system": "openai",
        "gen_ai.operation.name": "chat.completions",
        "gen_ai.model": "gpt-4",
      });
      aiSpan.end();
    });

    // This span will be kept by the filter (braintrust prefix)
    await tracer.startActiveSpan(
      "braintrust.evaluation",
      async (braintrustSpan) => {
        braintrustSpan.setAttributes({
          "braintrust.dataset": "test-dataset",
          "braintrust.experiment": "test-experiment",
        });
        braintrustSpan.end();
      },
    );

    // This span will be filtered out (no matching prefix)
    await tracer.startActiveSpan("database.query", async (dbSpan) => {
      dbSpan.setAttributes({
        "db.system": "postgresql",
        "db.statement": "SELECT * FROM users",
      });
      dbSpan.end();
    });

    rootSpan.end();
  });
}

// Run the example
async function runExample() {
  await makeRequest();

  // Force flush the BatchSpanProcessor to ensure all spans are exported
  // This is important because BatchSpanProcessor batches spans and may not
  // export them immediately
  await batchProcessor.forceFlush();
  // Also flush the exporter to ensure all data is sent
  await exporter.forceFlush();

  // Wait a moment for spans to be processed
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Wait a moment for the HTTP requests to complete
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(
    "\nSpans sent to Braintrust! Check your dashboard at https://braintrust.dev",
  );
  console.log(
    "Note: Only root spans and spans with gen_ai.*, braintrust.*, llm.*, ai.*, or traceloop.* prefixes were sent to Braintrust",
  );

  // Shutdown the exporter and SDK
  await exporter.shutdown();
  await sdk.shutdown();
}

runExample().catch(console.error);
