/* eslint-disable @typescript-eslint/no-explicit-any */
import { openai, OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import * as ai from "ai";

import type { InferUITools, ToolSet, UIDataTypes, UIMessage } from "ai";
import { wrapAISDK, initLogger } from "braintrust";

initLogger({ projectName: "example-ai-sdk-next-openai-app" });

const { convertToModelMessages, streamText, validateUIMessages } =
  (process.env.WRAPPED || "true") === "true" ? wrapAISDK(ai) : ai;

const tools = {
  code_interpreter: openai.tools.codeInterpreter(),
} satisfies ToolSet;

export type OpenAICodeInterpreterMessage = UIMessage<
  never,
  UIDataTypes,
  InferUITools<typeof tools>
>;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const uiMessages = await validateUIMessages({ messages });

  const result = streamText({
    model: openai("gpt-5-nano"),
    tools,
    messages: convertToModelMessages(uiMessages),
    onStepFinish: ({ request }: any) => {
      console.log(JSON.stringify(request.body, null, 2));
    },
    providerOptions: {
      openai: {
        store: false,
      } satisfies OpenAIResponsesProviderOptions,
    },
  });

  return result.toUIMessageStreamResponse();
}
