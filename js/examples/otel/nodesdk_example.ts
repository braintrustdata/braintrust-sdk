// nodesdk_example.ts
// 
// This example demonstrates the new @braintrust/otel package pattern.
// 
// Installation:
//   npm install @braintrust/otel @opentelemetry/sdk-node @opentelemetry/api
//
// Key changes from old pattern:
//   - Import from "@braintrust/otel" instead of "braintrust"
//   - No BRAINTRUST_OTEL_COMPAT environment variable needed
//   - Explicit OpenTelemetry dependencies in package.json
//
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import { trace } from "@opentelemetry/api";

const sdk = new NodeSDK({
  serviceName: "my-service",
  spanProcessor: new BraintrustSpanProcessor({
    parent: "project_name:otel-examples",
    filterAISpans: true,
  }),
});

sdk.start();

console.log("OpenTelemetry NodeSDK started with BraintrustSpanProcessor");
console.log("BRAINTRUST_API_KEY set:", !!process.env.BRAINTRUST_API_KEY);
console.log("OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY);

const tracer = trace.getTracer("my-service", "1.0.0");

async function makeRequest() {
  return tracer.startActiveSpan("nodesdk.example", async (rootSpan) => {
    rootSpan.setAttributes({
      "user.request": "openai_chat",
      "request.timestamp": new Date().toISOString(),
    });

    tracer.startActiveSpan("gen_ai.chat.completions", async (aiSpan) => {
      aiSpan.setAttributes({
        "gen_ai.system": "openai",
        "gen_ai.operation.name": "chat.completions",
      });
      aiSpan.end();
    });

    tracer.startActiveSpan("a_non_llm_span", async (span) => {
      span.end();
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
  await sdk.shutdown();
}

runExample();
