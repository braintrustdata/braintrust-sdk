#!/usr/bin/env tsx

import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic, initLogger } from "braintrust";

initLogger({ projectName: "typescript-examples" });

const client = wrapAnthropic(new Anthropic());

async function main() {
  const userMessage: Anthropic.MessageParam = {
    role: "user",
    content: "What is the weather in Toronto?",
  };
  const tools: Anthropic.Tool[] = [
    {
      name: "get_weather",
      description: "Get the weather for a specific location",
      input_schema: {
        type: "object",
        properties: { location: { type: "string" } },
      },
    },
  ];

  const message = await client.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    messages: [userMessage],
    tools,
  });
  console.log("Initial response:");
  console.dir(message, { depth: 4 });

  const tool = message.content.find(
    (content): content is Anthropic.ToolUseBlock => content.type === "tool_use",
  );
  if (!tool) {
    throw new Error("No tool used");
  }

  const result = await client.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    messages: [
      userMessage,
      { role: message.role, content: message.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: tool.id,
            content: [{ type: "text", text: "The weather is 73f" }],
          },
        ],
      },
    ],
    tools,
  });
  console.log("\nFinal response");
  console.dir(result, { depth: 4 });
}

main();
