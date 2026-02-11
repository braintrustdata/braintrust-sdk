/**
 * Anthropic Auto-Instrumentation Example
 *
 * This example demonstrates using Anthropic SDK with Braintrust auto-instrumentation.
 * No manual wrapping is needed - just initialize the logger and use Anthropic normally.
 *
 * Run with: npm run anthropic
 * Or: node --import @braintrust/auto-instrumentations/hook.mjs anthropic-example.js
 */

import "dotenv/config";
import { initLogger } from "braintrust";
import Anthropic from "@anthropic-ai/sdk";

// Check for required API keys
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
  console.error("Please create a .env file with your API key.");
  process.exit(1);
}

// Initialize Braintrust logging
initLogger({
  projectName: "auto-instrumentation-examples",
  apiKey: process.env.BRAINTRUST_API_KEY,
});

// Create Anthropic client normally - no wrapping needed!
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function main() {
  console.log("Making Anthropic messages request...");

  // This call will be automatically traced to Braintrust
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: "Explain what auto-instrumentation is in one sentence.",
      },
    ],
  });

  const response = message.content[0];
  console.log("\nResponse:", response.type === "text" ? response.text : "");
  console.log("\nTokens used:");
  console.log("  Input:", message.usage.input_tokens);
  console.log("  Output:", message.usage.output_tokens);
  console.log("\n✅ Request automatically traced to Braintrust!");
}

main().catch(console.error);
