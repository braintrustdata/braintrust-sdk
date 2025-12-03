// nodesdk_example.ts - OpenTelemetry v1.x example
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import { trace } from "@opentelemetry/api";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { runNodesdkExample } from "../common/nodesdk_example_common";

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

async function main() {
  await runNodesdkExample(sdk, "otel-v1-examples", true);
}

main().catch(console.error);
