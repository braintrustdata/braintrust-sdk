#!/usr/bin/env tsx

import Anthropic from "@anthropic-ai/sdk";

import { wrapAnthropic, initLogger } from "braintrust";

initLogger({ projectName: "typescript-examples" });

const client = wrapAnthropic(new Anthropic());

async function main() {
  console.log("\nPrompt: What is 6 squared?");
  const result = await client.beta.messages.create({
    messages: [{ role: "user", content: "What is 6 squared?" }],
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    system: [{ text: "Just return the number please.", type: "text" }],
  });
  console.dir(result);

  // Using create with stream=true
  console.log("\nPrompt: What is 7 squared?");
  const stream1 = await client.beta.messages.create({
    messages: [{ role: "user", content: "What is 7 squared?" }],
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    system: [{ text: "Just return the number please.", type: "text" }],
    stream: true,
  });
  for await (const chunk of stream1) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      console.log(chunk.delta.text);
    }
  }
  console.log();

  // Using messages.stream
  console.log("\nPrompt: What is 8 squared?");
  const stream2 = client.beta.messages.stream({
    messages: [{ role: "user", content: "What is 8 squared?" }],
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    system: [{ text: "Just return the number please.", type: "text" }],
  });
  for await (const chunk of stream2) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      console.log(chunk.delta.text);
    }
  }
  console.log();
}

main();
