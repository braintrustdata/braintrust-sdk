/**
 * Claude Agent SDK Auto-Instrumentation Example
 *
 * This example demonstrates using Claude Agent SDK with Braintrust auto-instrumentation.
 * Agent queries will be automatically traced.
 *
 * Run with: npm run claude-agent
 * Or: node --import @braintrust/auto-instrumentations/hook.mjs claude-agent-sdk-example.js
 */

import { initLogger } from "braintrust";
import { query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

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

// Create a simple calculator tool
const calculator = tool(
  "calculator",
  "Performs basic arithmetic operations (add, subtract, multiply, divide)",
  {
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number(),
  },
  async (args) => {
    let result;
    switch (args.operation) {
      case "add":
        result = args.a + args.b;
        break;
      case "subtract":
        result = args.a - args.b;
        break;
      case "multiply":
        result = args.a * args.b;
        break;
      case "divide":
        result = args.a / args.b;
        break;
    }
    return {
      content: [
        {
          type: "text",
          text: `${args.operation}(${args.a}, ${args.b}) = ${result}`,
        },
      ],
    };
  },
);

async function main() {
  console.log("Running Claude Agent SDK example...");

  const prompt = "What is 15 multiplied by 7? Use the calculator tool.";
  console.log(`\nPrompt: ${prompt}\n`);

  // This query will be automatically traced to Braintrust
  for await (const message of query({
    prompt,
    options: {
      model: "claude-sonnet-4-5",
      tools: [calculator],
      permissionMode: "bypassPermissions",
    },
  })) {
    if (message.type === "assistant") {
      const content = message.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            console.log(`Claude: ${block.text}`);
          } else if (block.type === "tool_use") {
            console.log(`\n[Tool Call: ${block.name}]`);
            console.log(`Input: ${JSON.stringify(block.input, null, 2)}`);
          }
        }
      }
    } else if (message.type === "result") {
      console.log("\n--- Result ---");
      console.log(`Turns: ${message.num_turns}`);
      console.log(`Input tokens: ${message.usage?.input_tokens}`);
      console.log(`Output tokens: ${message.usage?.output_tokens}`);
    }
  }

  console.log("\n✅ Agent query automatically traced to Braintrust!");
}

main().catch(console.error);
