/**
 * This example demonstrates how to use BraintrustSpanProcessor with OpenTelemetry v1.x when filtering AI spans.
 */
import {
  BasicTracerProvider,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BraintrustSpanProcessor, initOtel } from "@braintrust/otel";

const contextManager = new AsyncLocalStorageContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

// Initialize Braintrust OpenTelemetry
initOtel();

const provider = new BasicTracerProvider({
  resource: new Resource({
    "service.name": "custom-braintrust-service",
  }),
});
(provider as any).addSpanProcessor(
  // Add Braintrust span processor with filtering enabled
  new BraintrustSpanProcessor({
    parent: "project_name:otel-v1-examples",
    filterAISpans: true,
  }) as unknown as SpanProcessor,
);

trace.setGlobalTracerProvider(provider); // sets the global tracer provider

console.log(
  "OpenTelemetry BasicTracerProvider started with BraintrustSpanProcessor",
);
console.log("BRAINTRUST_API_KEY set:", !!process.env.BRAINTRUST_API_KEY);

const tracer = trace.getTracer("custom-braintrust-service", "1.0.0");

async function makeRequest() {
  return tracer.startActiveSpan("custom.user_request", async (rootSpan) => {
    rootSpan.setAttributes({
      "user.request": "custom_example",
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
  // Wait a moment for spans to be processed and sent
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(
    "\nSpans sent to Braintrust! Check your dashboard at https://braintrust.dev",
  );
  console.log(
    "Note: Only root spans and spans with gen_ai.*, braintrust.*, llm.*, ai.*, or traceloop.* prefixes were sent to Braintrust",
  );
  await provider.shutdown();
}

runExample();
