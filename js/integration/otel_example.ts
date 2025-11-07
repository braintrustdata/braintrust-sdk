// nodesdk_example.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BraintrustSpanProcessor } from "braintrust";
import { trace } from "@opentelemetry/api";

const sdk = new NodeSDK({
  serviceName: "my-service",
  spanProcessor: new BraintrustSpanProcessor({
    parent: "project_name:otel-examples",
    filterAISpans: true,
  }),
});

sdk.start();

async function main() {
  const tracer = trace.getTracer("my-tracer", "1.0.0");
  await tracer.startActiveSpan("otel.example", async (rootSpan) => {
    rootSpan.setAttributes({
      "user.request": "my-request",
      "request.timestamp": new Date().toISOString(),
    });

    tracer.startActiveSpan("chat.completion", async (aiSpan) => {
      aiSpan.setAttributes({
        model: "gpt-4o-mini",
      });
      aiSpan.end();
    });

    tracer.startActiveSpan("logging span", async (span) => {
      span.end();
    });

    rootSpan.end();
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sdk.shutdown();
  console.log(
    "Finished simple OTEL example. Check https://braintrust.dev for exported spans.",
  );
}

main().catch((error) => {
  console.error("Simple OTEL example failed:", error);
  process.exitCode = 1;
});
