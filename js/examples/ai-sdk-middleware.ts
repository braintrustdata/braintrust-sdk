#!/usr/bin/env tsx

import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { initLogger } from "../src/index";
import { Middleware } from "../src/wrappers/ai-sdk-middleware";

// Initialize Braintrust logging
initLogger({
  projectName: "ai-sdk-middleware-example",
});

// Create wrapped models with Braintrust tracing
// The middleware automatically detects providers (OpenAI, Anthropic, or any custom provider)
const wrappedOpenAI = wrapLanguageModel({
  model: openai("gpt-3.5-turbo"),
  middleware: Middleware({ debug: false, name: "OpenAIMiddleware" }),
});

const wrappedAnthropic = wrapLanguageModel({
  model: anthropic("claude-3-haiku-20240307"),
  middleware: Middleware({ debug: false, name: "AnthropicMiddleware" }),
});

async function exampleGenerateText() {
  console.log("=== Generate Text Examples ===\n");

  // OpenAI example
  console.log("OpenAI Generate Text:");
  const openaiResult = await generateText({
    model: wrappedOpenAI,
    prompt: "What is the capital of France?",
    system: "Provide a concise answer.",
  });
  console.log("Response:", openaiResult.text);
  console.log();

  // Anthropic example
  console.log("Anthropic Generate Text:");
  const anthropicResult = await generateText({
    model: wrappedAnthropic,
    prompt: "What is the capital of Italy?",
    system: "Provide a concise answer.",
  });
  console.log("Response:", anthropicResult.text);
  console.log();
}

async function exampleStreamText() {
  console.log("=== Stream Text Examples ===\n");

  // OpenAI streaming example
  console.log("OpenAI Stream Text:");
  const openaiStream = await streamText({
    model: wrappedOpenAI,
    prompt: "Write a short haiku about programming.",
    system: "Write only the haiku, no additional text.",
  });

  let openaiText = "";
  for await (const chunk of openaiStream.textStream) {
    process.stdout.write(chunk);
    openaiText += chunk;
  }
  console.log("\n");

  // Anthropic streaming example
  console.log("Anthropic Stream Text:");
  const anthropicStream = await streamText({
    model: wrappedAnthropic,
    prompt: "Write a short haiku about nature.",
    system: "Write only the haiku, no additional text.",
  });

  let anthropicText = "";
  for await (const chunk of anthropicStream.textStream) {
    process.stdout.write(chunk);
    anthropicText += chunk;
  }
  console.log("\n");
}

async function exampleErrorHandling() {
  console.log("=== Error Handling Example ===\n");

  const invalidModel = wrapLanguageModel({
    model: openai("invalid-model-name"),
    middleware: Middleware({ debug: true, name: "ErrorMiddleware" }),
  });

  try {
    await generateText({
      model: invalidModel,
      prompt: "This will fail",
    });
  } catch (error) {
    console.log("Caught expected error:", error.message);
  }
  console.log();
}

async function main() {
  console.log("AI SDK Middleware Example\n");
  console.log(
    "This example demonstrates Braintrust tracing with AI SDK v2 middleware.\n",
  );

  try {
    await exampleGenerateText();
    await exampleStreamText();
    await exampleErrorHandling();

    console.log(
      "Example completed! Check your Braintrust dashboard for traces.",
    );
  } catch (error) {
    console.error("Example failed:", error);
  }
}

// Run the example
main().catch(console.error);
