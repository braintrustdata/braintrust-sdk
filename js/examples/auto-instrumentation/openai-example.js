/**
 * OpenAI Auto-Instrumentation Example
 *
 * This example demonstrates using OpenAI SDK with Braintrust auto-instrumentation.
 * No manual wrapping is needed - just initialize the logger and use OpenAI normally.
 *
 * Run with: npm run openai
 * Or: node --import @braintrust/auto-instrumentations/hook.mjs openai-example.js
 */

import { initLogger } from "braintrust";
import OpenAI from "openai";

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

// Create OpenAI client normally - no wrapping needed!
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  console.log("Making OpenAI chat completion request...");

  // This call will be automatically traced to Braintrust
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a helpful assistant that provides concise answers.",
      },
      {
        role: "user",
        content: "What are the three primary colors?",
      },
    ],
    temperature: 0.7,
  });

  console.log("\nResponse:", completion.choices[0].message.content);
  console.log("\nTokens used:", completion.usage?.total_tokens ?? "unknown");
  console.log("\n✅ Request automatically traced to Braintrust!");
}

main().catch(console.error);
