#!/usr/bin/env node

/**
 * Minimal example demonstrating the tool call fix in Braintrust AI SDK wrapper
 *
 * Prerequisites:
 * 1. export OPENAI_API_KEY="your-key"
 * 2. export BRAINTRUST_API_KEY="your-key" (optional)
 * 3. npm install && npm start
 */

import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { wrapAISDKModel, initLogger, startSpan } from "../../dist/index.js";
import { z } from "zod";

// Initialize Braintrust
initLogger({
  projectName: "AI SDK Tool Calls Demo",
  apiKey: process.env.BRAINTRUST_API_KEY,
  telemetry: true,
});

// Define a simple weather tool
const getWeatherTool = {
  description: "Get weather for a location",
  parameters: z.object({
    location: z.string(),
    unit: z.enum(["celsius", "fahrenheit"]),
  }),
  execute: async ({ location, unit }) => {
    return {
      location,
      temperature: unit === "celsius" ? 22 : 72,
      unit,
      description: "Partly cloudy",
    };
  },
};

async function main() {
  const span = startSpan({ name: "AI SDK Tool Call Demo" });

  const model = wrapAISDKModel(openai("gpt-4"));

  const result = await generateText({
    model,
    prompt: "What is the weather like in San Francisco? Use celsius.",
    tools: { get_weather: getWeatherTool },
    maxToolRoundtrips: 1,
  });

  span.end();

  console.log("Response:", result.text);
  console.log("Tool calls made:", result.toolCalls?.length || 0);
  console.log("Span URL:", await span.permalink());
}

main().catch(console.error);
