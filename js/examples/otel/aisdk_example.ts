import { NodeSDK } from "@opentelemetry/sdk-node";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { BraintrustSpanProcessor } from "braintrust";

const sdk = new NodeSDK({
  spanProcessors: [
    new BraintrustSpanProcessor({
      parent: "project_name:ai sdk test",
      filterAISpans: true,
    }),
  ],
});

sdk.start();

const tracer = trace.getTracer("ai-sdk-example", "1.0.0");

async function main() {
  await tracer.startActiveSpan("http-request", async (httpSpan) => {
    try {
      httpSpan.setAttributes({
        "http.method": "POST",
        "http.url": "/api/chat",
        "http.scheme": "https",
        "user.id": "123",
      });

      await tracer.startActiveSpan("auth-middleware", async (authSpan) => {
        authSpan.setAttributes({
          "auth.method": "jwt",
          "auth.success": true,
        });
        authSpan.addEvent("User authenticated", { userId: "123" });
        authSpan.end();
      });

      await tracer.startActiveSpan("request-handler", async (handlerSpan) => {
        handlerSpan.setAttributes({
          "handler.name": "chatHandler",
          "handler.version": "v2",
        });

        await tracer.startActiveSpan("ai-service-call", async (aiSpan) => {
          aiSpan.setAttributes({
            "ai.provider": "openai",
            "ai.model": "gpt-4o-mini",
            "ai.operation": "generateText",
          });
          const result = await generateText({
            model: openai("gpt-4o-mini"),
            messages: [
              {
                role: "user",
                content:
                  "What are my orders and where are they? My user ID is 123",
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

          aiSpan.addEvent("AI response received", {
            toolCallsCount: result.toolCalls?.length || 0,
            finishReason: result.finishReason,
          });
          aiSpan.setStatus({ code: SpanStatusCode.OK });
          aiSpan.end();

          return result;
        });

        handlerSpan.end();
      });

      httpSpan.setAttributes({
        "http.status_code": 200,
        "http.response.content_length": 1234,
      });
      httpSpan.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      httpSpan.recordException(error as Error);
      httpSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    } finally {
      httpSpan.end();
    }
  });

  await sdk.shutdown();
}

main().catch(console.error);
