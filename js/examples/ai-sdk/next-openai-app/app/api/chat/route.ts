/* eslint-disable @typescript-eslint/no-explicit-any */
import { openai } from "@ai-sdk/openai";

// remember to build & then do a reinstall to see the latest
import { wrapAISDK, initLogger } from "braintrust";

import * as ai from "ai";
import { type UIMessage } from "ai";

initLogger({ projectName: "example-ai-sdk-next-openai-app" });

const { streamText } =
  (process.env.WRAPPED || "true") === "true" ? wrapAISDK(ai) : ai;

const { consumeStream, convertToModelMessages } = ai;

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const prompt = convertToModelMessages(messages);

  const result = streamText({
    model: openai("gpt-4o"),
    prompt,
    abortSignal: req.signal,
  });

  debugger;

  return result.toUIMessageStreamResponse({
    onFinish: async ({ isAborted }: any) => {
      if (isAborted) {
        console.log("Aborted");
      }
    },
    consumeSseStream: consumeStream, // needed for correct abort handling
  });
}
