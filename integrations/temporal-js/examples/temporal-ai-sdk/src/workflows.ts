// Load polyfills required for AI SDK v6 in Temporal workflows
import "@temporalio/ai-sdk/lib/load-polyfills";

import { generateText, tool } from "ai";
import { temporalProvider } from "@temporalio/ai-sdk";
import { proxyActivities } from "@temporalio/workflow";
import { z } from "zod";
import type * as activities from "./activities";

const { getWeather } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

const { generateTextTraced } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

/**
 * Haiku Agent - generates a haiku about a given topic
 */
export async function haikuAgent(topic: string): Promise<string> {
  const { text } = await generateText({
    model: temporalProvider.languageModel("gpt-4o-mini"),
    system: "You only respond in haikus",
    prompt: `Write a haiku about ${topic}`,
  });

  return text;
}

/**
 * Tools Agent - uses AI with a weather tool
 */
export async function toolsAgent(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: temporalProvider.languageModel("gpt-4o-mini"),
    tools: {
      getWeather: tool({
        description: "Get the weather for a location",
        parameters: z.object({
          location: z.string().describe("The location to get weather for"),
        }),
        // Tools must use Temporal activities for non-deterministic operations
        execute: async ({ location }) => {
          return await getWeather({ location });
        },
      }),
    },
    prompt,
    maxToolRoundtrips: 5,
  });

  return text;
}

// tracing full llm with wrapAISDK in the activity implementation
export async function haikuAgentTraced(topic: string): Promise<string> {
  return await generateTextTraced({
    modelId: "gpt-4o-mini",
    system: "You only respond in haikus",
    prompt: `Write a haiku about ${topic}`,
  });
}
