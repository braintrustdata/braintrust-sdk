import { NodeSDK } from "@opentelemetry/sdk-node";
import { trace, context } from "@opentelemetry/api";
import * as ai from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { BraintrustSpanProcessor } from "@braintrust/otel";

const sdk = new NodeSDK({
  spanProcessor: new BraintrustSpanProcessor({
    parent: "project_name:otel-v1-examples",
    filterAISpans: true,
  }),
});

sdk.start();

interface ListOrdersToolArgs {
  userId: string;
}

interface ViewTrackingInformationToolArgs {
  orderId: string;
}

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

async function main() {
  // const provider = new BasicTracerProvider();
  // provider.addSpanProcessor(new BraintrustSpanProcessor());
  // provider.register();
  //trace.setGlobalTracerProvider(provider);
  const tracer = trace.getTracer("ai");
  const result = await ai.generateText({
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
      //functionId: "my-awesome-function",
      //metadata: { something: "custom", someOtherThing: "other-value" },
      //tracer: tracer,
    },
    stopWhen: ai.stepCountIs(10),
  });

  console.log(result.text);
  await sdk.shutdown();
}

main().catch(console.error);
