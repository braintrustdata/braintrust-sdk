#!/usr/bin/env npx tsx

/**
 * Custom OpenTelemetry Configuration Example
 *
 * This example shows how to manually configure OpenTelemetry
 * with custom settings and filtering.
 *
 * To run this example:
 * 1. Install OpenTelemetry packages: npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
 * 2. Set environment variables:
 *    - BRAINTRUST_API_KEY=your-api-key
 *    - BRAINTRUST_PARENT=project_name:experiment_name (optional)
 * 3. Run: npx tsx custom_otel_example.ts
 */

import { trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

// Import our custom OpenTelemetry classes
import {
  OtelExporter,
  LLMSpanProcessor,
  Processor,
  CustomFilter,
} from "../../src/otel";

// Initialize OpenTelemetry SDK
const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "braintrust-custom-otel-example",
    [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.0",
  }),
});

sdk.start();

// Define a custom filter function
const customFilter: CustomFilter = (span) => {
  // Always keep spans that contain "important" in the name
  if (span.name.includes("important")) {
    return true;
  }

  // Always drop spans that contain "debug" in the name
  if (span.name.includes("debug")) {
    return false;
  }

  // For everything else, use default LLM filtering logic
  return null;
};

async function example1_BasicExporter() {
  console.log("\n📝 Example 1: Basic OtelExporter");

  try {
    // Create a basic exporter
    const exporter = new OtelExporter({
      apiKey: process.env.BRAINTRUST_API_KEY,
      parent: process.env.BRAINTRUST_PARENT || "js-example:custom-otel",
      headers: {
        "x-example": "custom-header",
      },
    });

    console.log(`✅ Created OtelExporter with parent: ${exporter.parent}`);
  } catch (error) {
    console.error("❌ Failed to create OtelExporter:", error);
  }
}

async function example2_ProcessorWithoutFiltering() {
  console.log("\n📝 Example 2: Processor without LLM filtering");

  try {
    // Create processor without filtering
    const processor = new Processor({
      apiKey: process.env.BRAINTRUST_API_KEY,
      parent: "js-example:no-filter",
      enableLlmFiltering: false,
    });

    // Add to global tracer provider
    const provider = trace.getTracerProvider();
    if (typeof provider.addSpanProcessor === "function") {
      provider.addSpanProcessor(processor);
    }

    console.log("✅ Created Processor without LLM filtering");
  } catch (error) {
    console.error("❌ Failed to create Processor:", error);
  }
}

async function example3_ProcessorWithFiltering() {
  console.log("\n📝 Example 3: Processor with LLM filtering and custom filter");

  try {
    // Create processor with LLM filtering and custom filter
    const processor = new Processor({
      apiKey: process.env.BRAINTRUST_API_KEY,
      parent: "js-example:with-filter",
      enableLlmFiltering: true,
      customFilter: customFilter,
    });

    // Add to global tracer provider
    const provider = trace.getTracerProvider();
    if (typeof provider.addSpanProcessor === "function") {
      provider.addSpanProcessor(processor);
    }

    console.log("✅ Created Processor with LLM filtering and custom filter");
  } catch (error) {
    console.error("❌ Failed to create Processor with filtering:", error);
  }
}

async function example4_SpanFiltering() {
  console.log("\n📝 Example 4: Demonstrating span filtering");

  const tracer = trace.getTracer("filtering-example");

  // Create a variety of spans to test filtering
  const rootSpan = tracer.startSpan("user_workflow");

  try {
    // This should be kept (root span)
    rootSpan.setAttributes({
      "user.id": "test-user",
      "workflow.type": "example",
    });

    // This should be filtered out (no LLM attributes)
    const dbSpan = tracer.startSpan("database_operation", { parent: rootSpan });
    dbSpan.setAttributes({ "db.system": "postgresql" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    dbSpan.end();

    // This should be kept (gen_ai prefix)
    const llmSpan = tracer.startSpan("gen_ai.chat_completion", {
      parent: rootSpan,
    });
    llmSpan.setAttributes({
      "gen_ai.model": "gpt-4",
      "gen_ai.request.temperature": 0.7,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    llmSpan.end();

    // This should be kept (has llm attribute)
    const processingSpan = tracer.startSpan("response_processing", {
      parent: rootSpan,
    });
    processingSpan.setAttributes({
      "llm.tokens": 100,
      "processing.duration": 0.15,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    processingSpan.end();

    // This should be kept (custom filter - contains "important")
    const importantSpan = tracer.startSpan("important_operation", {
      parent: rootSpan,
    });
    importantSpan.setAttributes({ "operation.type": "critical" });
    await new Promise((resolve) => setTimeout(resolve, 25));
    importantSpan.end();

    // This should be filtered out (custom filter - contains "debug")
    const debugSpan = tracer.startSpan("debug_logging", { parent: rootSpan });
    debugSpan.setAttributes({ "debug.level": "info" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    debugSpan.end();

    console.log("✅ Created example spans for filtering demonstration");
  } finally {
    rootSpan.end();
  }
}

async function main() {
  console.log("🚀 Starting custom OpenTelemetry configuration example...");
  console.log("🔧 Configuration:");
  console.log(
    `   BRAINTRUST_API_KEY: ${process.env.BRAINTRUST_API_KEY ? "***" : "not set"}`,
  );
  console.log(
    `   BRAINTRUST_PARENT: ${process.env.BRAINTRUST_PARENT || "not set"}`,
  );

  await example1_BasicExporter();
  await example2_ProcessorWithoutFiltering();
  await example3_ProcessorWithFiltering();
  await example4_SpanFiltering();

  // Give time for spans to be exported
  console.log("\n⏳ Waiting for spans to be exported...");
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("🔄 Shutting down SDK...");
  await sdk.shutdown();
  console.log("✅ Done!");
}

main().catch(console.error);
