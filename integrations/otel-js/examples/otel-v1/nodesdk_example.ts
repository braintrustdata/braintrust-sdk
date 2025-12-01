// nodesdk_example.ts - OpenTelemetry v1.x example
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import { trace } from "@opentelemetry/api";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { initLogger, login } from "braintrust";

const sdk = new NodeSDK({
  resource: new Resource({
    "service.name": "my-service",
  }),
  spanProcessor: new BraintrustSpanProcessor({
    parent: "project_name:otel-v1-examples",
    filterAISpans: true,
  }) as unknown as SpanProcessor,
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
  await login();
  const logger = initLogger({ projectName: "otel-v1-examples" });

  let spanLink: string | undefined;
  await logger.traced(async (rootSpan) => {
    spanLink = rootSpan.link();
    // Create OpenTelemetry spans within the Braintrust span context
    await makeRequest();
  });

  // Wait a moment for spans to be processed and sent
  await logger.flush();
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log(
    "\nSpans sent to Braintrust! Check your dashboard at https://braintrust.dev",
  );
  if (spanLink) {
    console.log(`\nView trace: ${spanLink}`);
  }
  await sdk.shutdown();
}

runExample();
