// nodesdk_example.ts - OpenTelemetry v2.x example
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import { runNodesdkExample } from "../common/nodesdk_example_common";

const sdk = new NodeSDK({
  spanProcessors: [
    new BraintrustSpanProcessor({
      parent: "project_name:otel-v2-examples",
      filterAISpans: true,
    }),
  ],
});

sdk.start();

console.log("OpenTelemetry v2.x NodeSDK started with BraintrustSpanProcessor");
console.log("BRAINTRUST_API_KEY set:", !!process.env.BRAINTRUST_API_KEY);
console.log("OPENAI_API_KEY set:", !!process.env.OPENAI_API_KEY);

async function main() {
  await runNodesdkExample(sdk, "otel-v2-examples", false);
}

main().catch(console.error);
