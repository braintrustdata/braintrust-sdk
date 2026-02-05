import { wrapAISDK } from "braintrust";
import * as ai from "ai";
import { openai } from "@ai-sdk/openai";

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
 * Pattern 2 Activity: Generate text with full LLM tracing
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
