import type { NodeSDK } from "@opentelemetry/sdk-node";

interface ListOrdersToolArgs {
  userId: string;
}

interface ViewTrackingInformationToolArgs {
  orderId: string;
}

export async function runAISDKExample(
  sdk: NodeSDK,
  aiModule: typeof import("ai"),
  openaiModule: typeof import("@ai-sdk/openai"),
  zodModule: typeof import("zod"),
) {
  const { generateText, stepCountIs } = aiModule;
  const { openai } = openaiModule;
  const { z } = zodModule;

  const listOrdersTool = {
    description: "List all orders for a user",
    inputSchema: z.object({ userId: z.string() }),
    execute: async (args: unknown) => {
      const typedArgs = args as ListOrdersToolArgs;
      return `User ${typedArgs.userId} has the following orders: 1`;
    },
  };

  const viewTrackingInformationTool = {
    description: "View tracking information for an order",
    inputSchema: z.object({ orderId: z.string() }),
    execute: async (args: unknown) => {
      const typedArgs = args as ViewTrackingInformationToolArgs;
      return `Tracking info for ${typedArgs.orderId}`;
    },
  };

  const result = await generateText({
    model: openai("gpt-5-mini"),
    messages: [
      {
        role: "user",
        content: "What are my orders and where are they? My user ID is 123",
      },
    ],
    tools: {
      listOrders: listOrdersTool,
      viewTrackingInformation: viewTrackingInformationTool,
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: "my-awesome-function",
      metadata: { something: "custom", someOtherThing: "other-value" },
    },
    stopWhen: stepCountIs(10),
  });

  console.log(result.text);
  await sdk.shutdown();
}
