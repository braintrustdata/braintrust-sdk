/**
 * Vercel AI SDK Auto-Instrumentation Example
 *
 * This example demonstrates using Vercel AI SDK with Braintrust auto-instrumentation.
 * The generateText function will be automatically traced.
 *
 * Run with: npm run vercel
 * Or: node --import @braintrust/auto-instrumentations/hook.mjs vercel-ai-sdk-example.js
 */

import "dotenv/config";
import { initLogger } from "braintrust";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

// Check for required API keys
if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is not set.");
  console.error("Please create a .env file with your API key.");
  process.exit(1);
}

// Initialize Braintrust logging
initLogger({
  projectName: "auto-instrumentation-examples",
  apiKey: process.env.BRAINTRUST_API_KEY,
});

async function main() {
  console.log("Generating text with Vercel AI SDK...");

  // This call will be automatically traced to Braintrust
  const result = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: "What are the benefits of using TypeScript?",
  });

  console.log("\nResponse:", result.text);
  console.log("\nUsage:");
  console.log("  Prompt tokens:", result.usage.promptTokens);
  console.log("  Completion tokens:", result.usage.completionTokens);
  console.log("  Total tokens:", result.usage.totalTokens);
  console.log("\n✅ Request automatically traced to Braintrust!");
}

main().catch(console.error);
