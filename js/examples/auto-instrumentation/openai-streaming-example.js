/**
 * OpenAI Streaming Auto-Instrumentation Example
 *
 * This example demonstrates streaming responses from OpenAI with auto-instrumentation.
 *
 * Run with: npm run openai-streaming
 * Or: node --import @braintrust/auto-instrumentations/hook.mjs openai-streaming-example.js
 */

import "dotenv/config";
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
  console.log("Making streaming OpenAI chat completion request...\n");

  // Streaming call will be automatically traced
  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: "Write a haiku about TypeScript.",
      },
    ],
    stream: true,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    process.stdout.write(content);
    fullText += content;
  }

  console.log("\n\n✅ Streaming request automatically traced to Braintrust!");
}

main().catch(console.error);
