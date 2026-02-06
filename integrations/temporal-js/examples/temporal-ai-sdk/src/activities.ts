import { wrapAISDK } from "braintrust";
import * as ai from "ai";
import { openai } from "@ai-sdk/openai";
import { jsonSchema } from "ai";

// Wrap the AI SDK module for full LLM tracing
const wrappedAI = wrapAISDK(ai);

export async function getWeather(input: {
  location: string;
}): Promise<{ city: string; temperatureRange: string; conditions: string }> {
  return {
    city: input.location,
    temperatureRange: "14-20C",
    conditions: "Sunny with wind.",
  };
}

/**
 * Activity: Generate text with full LLM tracing
 * Uses wrapAISDK to capture all LLM details (prompts, completions, tokens, etc.)
 */
export async function generateTextTraced(params: {
  modelId: string;
  prompt: string;
  system?: string;
}): Promise<string> {
  // BraintrustTemporalPlugin already created an activity span
  // wrapAISDK will create child LLM spans automatically
  const result = await wrappedAI.generateText({
    model: openai(params.modelId),
    system: params.system,
    prompt: params.prompt,
  });
  return result.text;
}

/**
 * Activity with Tools: Generate text with full LLM + tool tracing
 * This gives you complete tracing:
 * - Temporal activity span (from BraintrustTemporalPlugin)
 * - LLM call spans (from wrapAISDK)
 * - Tool calls and results (from wrapAISDK)
 */
export async function generateTextWithToolsTraced(params: {
  modelId: string;
  prompt: string;
}): Promise<string> {
  const result = await wrappedAI.generateText({
    model: openai(params.modelId),
    prompt: params.prompt,
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
        // Execute function runs inside this activity during LLM call
        // wrapAISDK will trace this tool call and its results
        execute: async ({ location }: { location: string }) => {
          const weather = await getWeather({ location });
          return JSON.stringify(weather);
        },
      },
    },
  });

  return result.text;
}
