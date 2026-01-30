/**
 * Claude Agent SDK Example with Braintrust Tracing
 *
 * Demonstrates:
 * 1. Wrapping the Claude Agent SDK for automatic tracing
 * 2. SDK MCP tool (calculator) - local in-process tool
 * 3. Remote MCP server (braintrust) - stdio-based MCP server
 * 4. Subagent spawning via Task tool
 * 5. All tool calls traced via PreToolUse/PostToolUse hooks
 * 6. Subagent lifecycle traced via SubagentStart/SubagentStop hooks
 *
 * Run: make run
 */

import * as claudeSDK from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { wrapClaudeAgentSDK, initLogger } from "braintrust";

// Initialize Braintrust logger
initLogger({
  projectName: "Claude Agent SDK Example",
  apiKey: process.env.BRAINTRUST_API_KEY,
});

// Wrap the Claude Agent SDK for automatic tracing
const { query, tool, createSdkMcpServer } = wrapClaudeAgentSDK(claudeSDK);

// Create a calculator tool (SDK MCP - local)
const calculator = tool(
  "calculator",
  "Performs basic arithmetic operations (add, subtract, multiply, divide)",
  {
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number(),
  },
  async (args: { operation: string; a: number; b: number }) => {
    let result: number;
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
      default:
        return {
          content: [
            { type: "text", text: `Unknown operation: ${args.operation}` },
          ],
          isError: true,
        };
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
  console.log("Starting Claude Agent SDK example with Braintrust tracing...\n");
  console.log("This example demonstrates:");
  console.log("  - SDK MCP: calculator (local in-process tool)");
  console.log("  - Remote MCP: braintrust (stdio server via npx)");
  console.log("  - Subagents: math-expert (via Task tool)\n");

  // SDK MCP server (local, in-process)
  const calculatorServer = createSdkMcpServer({
    name: "calculator",
    version: "1.0.0",
    tools: [calculator],
  });

  // Check for Braintrust API key for the remote MCP server
  const braintrustApiKey = process.env.BRAINTRUST_API_KEY;
  if (!braintrustApiKey) {
    console.warn(
      "Warning: BRAINTRUST_API_KEY not set. Braintrust MCP server may not work.\n",
    );
  }

  const prompt = `Do three things:
1. Use the calculator to multiply 25 by 4
2. Spawn a math-expert subagent to calculate the factorial of 5 and explain what factorial means
3. List my braintrust projects

Report all results.`;

  console.log(`Prompt: ${prompt}\n`);

  for await (const message of query({
    prompt,
    options: {
      model: "claude-sonnet-4-20250514",
      permissionMode: "bypassPermissions",
      // Enable Task tool for subagent spawning
      allowedTools: ["Task"],
      // Define custom subagents
      agents: {
        "math-expert": {
          description:
            "Math specialist for complex calculations and explanations",
          prompt:
            "You are a math expert. Explain mathematical concepts clearly and perform calculations step by step.",
          model: "haiku",
        },
      },
      mcpServers: {
        // SDK MCP (local)
        calculator: calculatorServer,
        // Remote MCP (stdio) - Braintrust MCP server
        braintrust: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@braintrust/mcp-server@latest"],
          env: {
            BRAINTRUST_API_KEY: braintrustApiKey || "",
          },
        },
      },
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

  console.log("\n✓ Done! Check Braintrust for traces.");
}

main().catch(console.error);
