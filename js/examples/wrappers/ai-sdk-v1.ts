import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { wrapAISDKModel, initLogger, traced } from "../../dist/index.js";
import { z } from "zod/v3";

initLogger({
  projectName: "AI SDK Tool Calls Demo",
  apiKey: process.env.BRAINTRUST_API_KEY,
});

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
  traced(
    async (span) => {
      const model = wrapAISDKModel(openai("gpt-4"));

      const result = await generateText({
        model,
        prompt: "What is the weather like in San Francisco? Use celsius.",
        tools: { get_weather: getWeatherTool },
      });

      console.log("Response:", result.text);
      console.log("Tool calls made:", result.toolCalls?.length || 0);
      console.log("Span URL:", await span.permalink());
    },
    { name: "AI SDK Tool Call Demo" },
  );
}

main().catch(console.error);
