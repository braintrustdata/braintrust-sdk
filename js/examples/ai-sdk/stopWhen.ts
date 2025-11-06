/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import * as ai from "ai";
import { wrapAISDK } from "ai-sdk";
import { initLogger } from "../../../logger";
import { configureNode } from "../../../node";
import { openai } from "@ai-sdk/openai";

configureNode();

const SHOULD_WRAP = (process.env.WRAPPED || "true") === "true";

const { generateText, tool, hasToolCall } = SHOULD_WRAP ? wrapAISDK(ai) : ai;

initLogger({ projectName: "examples-ai-sdk-stopWhen" });

const main = async () => {
  const example = await generateText({
    model: openai("gpt-4o"),
    tools: {
      weather: tool({
        description: "Get the weather in a location",
        inputSchema: z.object({
          location: z.string().describe("The location to get the weather for"),
        }),
        execute: async ({ location }: any) => ({
          location,
          temperature: 72 + Math.floor(Math.random() * 21) - 10,
        }),
      }),
      submitAnswer: tool({
        description: "Submit the final answer to the user",
        inputSchema: z.object({
          answer: z.string().describe("The final answer to submit"),
        }),
        execute: async ({ answer }: any) => ({
          submitted: true,
          answer,
        }),
      }),
    },
    stopWhen: hasToolCall("weather"), // Stop when submitAnswer is called
    prompt:
      "What is the weather in San Francisco? After you get the weather, use the submitAnswer tool to provide your final response.",
  });

  console.log("Steps taken:", example.steps.length);
  console.log("Response:", example.text);
  console.log(
    "submitAnswer called:",
    example.steps.some((step: any) =>
      step.toolCalls?.some((tc: any) => tc.toolName === "submitAnswer"),
    ),
  );
};

main().catch(console.error);
