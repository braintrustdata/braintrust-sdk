// custom_otel_example.ts
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { BraintrustSpanProcessor } from "../../src";

const provider = new BasicTracerProvider({
  spanProcessors: [
    // Add Braintrust span processor with filtering enabled
    new BraintrustSpanProcessor({
      parent: "project_name:otel_examples",
      filterAISpans: true,
    }),
  ],
});

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
    tracer.startActiveSpan("gen_ai.chat.completions", async (aiSpan) => {
      aiSpan.setAttributes({
        "gen_ai.system": "openai",
        "gen_ai.operation.name": "chat.completions",
        "gen_ai.model": "gpt-4",
      });
      aiSpan.end();
    });

    // This span will be kept by the filter (braintrust prefix)
    tracer.startActiveSpan("braintrust.evaluation", async (braintrustSpan) => {
      braintrustSpan.setAttributes({
        "braintrust.dataset": "test-dataset",
        "braintrust.experiment": "test-experiment",
      });
      braintrustSpan.end();
    });

    // This span will be filtered out (no matching prefix)
    tracer.startActiveSpan("database.query", async (dbSpan) => {
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
    "Note: Only root spans and spans with gen_ai.*, braintrust.*, llm.*, or ai.* prefixes were sent to Braintrust",
  );
  await provider.shutdown();
}

runExample();
