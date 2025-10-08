import { openai } from "@ai-sdk/openai";
import * as ai from "ai";
import { z } from "zod";
import { Readable } from "node:stream";
import { initLogger, wrapAISDK } from "../../src";

initLogger({
  projectName: "My AI Project",
  apiKey: process.env.BRAINTRUST_API_KEY,
});

const { streamObject } = wrapAISDK(ai);

export const notificationSchema = z.object({
  notifications: z.array(
    z.object({
      name: z.string().describe("Name of a fictional person."),
      message: z.string().describe("Message. Do not use emojis or links."),
    }),
  ),
});

async function main() {
  const result = streamObject({
    model: openai("gpt-4.1"),
    schema: notificationSchema,
    prompt: `Generate 3 notifications for a messages app in this context: Messages during finals week.`,
  });

  const response = result.toTextStreamResponse();

  const chunks = [];
  if (response.body) {
    const stream = Readable.fromWeb(response.body as any);

    for await (const chunk of stream) {
      chunks.push(chunk.toString());
    }
  }

  console.log(JSON.parse(chunks.join("")));
}

main().catch(console.error);
