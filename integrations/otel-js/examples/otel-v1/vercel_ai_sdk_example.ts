/**
 * Vercel AI SDK + Braintrust example
 *
 * Simple example similar to `aisdk_example.ts` / `nodesdk_example.ts`:
 * - Uses `NodeSDK` with `BraintrustSpanProcessor`
 * - Makes a single Vercel AI SDK `generateText` call
 * - Shuts down the SDK to flush spans to Braintrust
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { trace } from "@opentelemetry/api";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// Validate API key before creating processor
const apiKey = process.env.BRAINTRUST_API_KEY;
if (!apiKey) {
  throw new Error(
    "BRAINTRUST_API_KEY environment variable is required. " +
      "Set it with: export BRAINTRUST_API_KEY='your-api-key'",
  );
}

const sdk = new NodeSDK({
  serviceName: "vercel-ai-sdk-example",
  spanProcessor: new BraintrustSpanProcessor({
    apiKey: apiKey, // Explicitly pass API key
    parent: "project_name:otel-v1-examples",
    filterAISpans: true,
  }) as unknown as SpanProcessor,
});

sdk.start();

console.log("OpenTelemetry NodeSDK started with BraintrustSpanProcessor");
console.log("BRAINTRUST_API_KEY set:", !!process.env.BRAINTRUST_API_KEY);
console.log("OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY);

const tracer = trace.getTracer("vercel-ai-sdk-example", "1.0.0");

export async function exampleGenerateText() {
  return tracer.startActiveSpan("vercel.ai.generateText", async (span) => {
    try {
      span.setAttributes({
        "gen_ai.system": "openai",
        "gen_ai.operation.name": "chat.completions",
        "gen_ai.model": "gpt-4o-mini",
      });

      const result = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: "Reply with the single word: ok",
        experimental_telemetry: {
          isEnabled: true,
          functionId: "vercel-ai-sdk-simple-example",
        },
      });

      console.log("\n=== Vercel AI SDK result ===");
      console.log(result.text);

      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}

async function runExample() {
  try {
    await exampleGenerateText();

    // Wait a moment for spans to be processed and sent
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(
      "\nSpans sent to Braintrust! Check your dashboard at https://braintrust.dev",
    );
  } finally {
    await sdk.shutdown();
  }
}

runExample().catch((error) => {
  console.error("Vercel AI SDK example failed:", error);
  process.exit(1);
});
