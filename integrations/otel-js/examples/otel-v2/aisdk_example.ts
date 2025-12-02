import { NodeSDK } from "@opentelemetry/sdk-node";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import * as ai from "ai";
import * as openaiModule from "@ai-sdk/openai";
import * as zod from "zod";
import { runAISDKExample } from "../common/aisdk_example_common";

const sdk = new NodeSDK({
  spanProcessors: [
    new BraintrustSpanProcessor({
      parent: "project_name:otel-v2-examples",
      filterAISpans: true,
    }) as unknown as SpanProcessor,
  ],
});

sdk.start();

async function main() {
  await runAISDKExample(sdk, ai, openaiModule, zod);
}

main().catch(console.error);
