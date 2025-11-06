import { NodeSDK } from "@opentelemetry/sdk-node";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod/v3";
import { BraintrustSpanProcessor } from "@braintrust/otel";

const sdk = new NodeSDK({
  spanProcessors: [
    new BraintrustSpanProcessor({
      parent: "project_name:ai sdk test",
      filterAISpans: true,
    }),
  ],
});

sdk.start();

async function main() {
  const result = await generateText({
    model: openai("gpt-4o-mini"),
    messages: [
      {
        role: "user",
        content: "What are my orders and where are they? My user ID is 123",
      },
    ],
    tools: {
      listOrders: tool({
        description: "list all orders",
        parameters: z.object({ userId: z.string() }),
        execute: async ({ userId }) =>
          `User ${userId} has the following orders: 1`,
      }),
      viewTrackingInformation: tool({
        description: "view tracking information for a specific order",
        parameters: z.object({ orderId: z.string() }),
        execute: async ({ orderId }) =>
          `Here is the tracking information for ${orderId}`,
      }),
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: "my-awesome-function",
      metadata: {
        something: "custom",
        someOtherThing: "other-value",
      },
    },
    maxSteps: 10,
  });

  await sdk.shutdown();
}

main().catch(console.error);
