#!/usr/bin/env npx tsx

/**
 * Auto OpenTelemetry Configuration Example
 *
 * This example shows how to use automatic OpenTelemetry configuration
 * with environment variables.
 *
 * To run this example:
 * 1. Install OpenTelemetry packages: npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
 * 2. Set environment variables:
 *    - BRAINTRUST_API_KEY=your-api-key
 *    - BRAINTRUST_PARENT=project_name:experiment_name
 *    - BRAINTRUST_OTEL_ENABLE=true
 *    - BRAINTRUST_OTEL_ENABLE_LLM_FILTER=true (optional)
 * 3. Run: npx tsx auto_otel_example.ts
 */

import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

// Initialize OpenTelemetry SDK first
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "braintrust-auto-otel-example",
    [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.0",
  }),
});

sdk.start();

// Import braintrust/otel after SDK is initialized
// This will auto-configure if BRAINTRUST_OTEL_ENABLE=true
import "../../src/otel";

// Get a tracer
const tracer = trace.getTracer("example-tracer");

async function simulateWorkflow() {
  const span = tracer.startSpan("user_request");

  try {
    // This span should be kept (root span)
    span.setAttributes({
      "user.id": "123",
      "request.type": "chat",
    });

    // Simulate some database work (should be filtered out)
    const dbSpan = tracer.startSpan("database_query", { parent: span });
    dbSpan.setAttributes({
      "db.system": "postgresql",
      "db.statement": "SELECT * FROM users WHERE id = $1",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    dbSpan.end();

    // Simulate LLM work (should be kept)
    const llmSpan = tracer.startSpan("gen_ai.completion", { parent: span });
    llmSpan.setAttributes({
      "gen_ai.model": "gpt-4",
      "gen_ai.request.temperature": 0.7,
      "gen_ai.response.tokens": 150,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    llmSpan.end();

    // Simulate more work with LLM attributes (should be kept)
    const processingSpan = tracer.startSpan("response_processing", {
      parent: span,
    });
    processingSpan.setAttributes({
      "llm.tokens": 150,
      "processing.time": 0.3,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    processingSpan.end();

    // Regular HTTP work (should be filtered out)
    const httpSpan = tracer.startSpan("http_response", { parent: span });
    httpSpan.setAttributes({
      "http.status_code": 200,
      "http.method": "POST",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    httpSpan.end();

    console.log("✅ Auto-configured OpenTelemetry workflow completed");
    console.log(
      "📊 Spans sent to Braintrust (only root and LLM-related spans if filtering is enabled)",
    );
  } catch (error) {
    span.recordException(error as Error);
    console.error("❌ Error:", error);
  } finally {
    span.end();
  }
}

async function main() {
  console.log("🚀 Starting auto-configured OpenTelemetry example...");
  console.log("🔧 Environment variables:");
  console.log(
    `   BRAINTRUST_OTEL_ENABLE: ${process.env.BRAINTRUST_OTEL_ENABLE}`,
  );
  console.log(
    `   BRAINTRUST_OTEL_ENABLE_LLM_FILTER: ${process.env.BRAINTRUST_OTEL_ENABLE_LLM_FILTER}`,
  );
  console.log(
    `   BRAINTRUST_API_KEY: ${process.env.BRAINTRUST_API_KEY ? "***" : "not set"}`,
  );
  console.log(
    `   BRAINTRUST_PARENT: ${process.env.BRAINTRUST_PARENT || "not set"}`,
  );
  console.log("");

  await simulateWorkflow();

  // Give time for spans to be exported
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log("🔄 Shutting down SDK...");
  await sdk.shutdown();
  console.log("✅ Done!");
}

main().catch(console.error);
