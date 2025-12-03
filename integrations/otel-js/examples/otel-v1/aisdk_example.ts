import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { BraintrustSpanProcessor } from "@braintrust/otel";
import * as ai from "ai";
import * as openaiModule from "@ai-sdk/openai";
import * as zod from "zod";
import { runAISDKExample } from "../common/aisdk_example_common";

const sdk = new NodeSDK({
  resource: new Resource({
    "service.name": "my-service",
  }),
  spanProcessor: new BraintrustSpanProcessor({
    parent: "project_name:otel-v1-examples",
    filterAISpans: true,
  }),
});

sdk.start();

async function main() {
  await runAISDKExample(sdk, ai, openaiModule, zod);
}

main().catch(console.error);
