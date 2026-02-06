// Load polyfills required for AI SDK v6 in Temporal workflows
import "@temporalio/ai-sdk/lib/load-polyfills";

import { generateText, jsonSchema } from "ai";
import { temporalProvider } from "@temporalio/ai-sdk";
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities";

const { getWeather } = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

const { generateTextTraced, generateTextWithToolsTraced } = proxyActivities<
  typeof activities
>({
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
      getWeather: {
        description: "Get the weather for a location",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The location to get weather for",
            },
          },
          required: ["location"],
        }),
        // Tools must use Temporal activities for non-deterministic operations
        execute: async ({ location }: { location: string }) => {
          return await getWeather({ location });
        },
      },
    },
    prompt,
  });

  return text;
}

// Tracing full llm with wrapAISDK in the activity implementation
export async function haikuAgentTraced(topic: string): Promise<string> {
  return await generateTextTraced({
    modelId: "gpt-4o-mini",
    system: "You only respond in haikus",
    prompt: `Write a haiku about ${topic}`,
  });
}

// Tracing Tools Agent with full LLM + tool tracing via wrapAISDK
export async function toolsAgentTraced(prompt: string): Promise<string> {
  return await generateTextWithToolsTraced({
    modelId: "gpt-4o-mini",
    prompt,
  });
}
