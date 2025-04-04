#!/usr/bin/env tsx

import Anthropic from "@anthropic-ai/sdk";

import { wrapAnthropic, initLogger } from "braintrust";
initLogger({ projectName: "anthropic-typescript-example" });

const client = wrapAnthropic(new Anthropic());

async function main() {
  const result = await client.messages.create({
    messages: [
      {
        role: "user",
        content: "Hey Claude!?",
      },
    ],
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1024,
    system: [
      {
        text: "do this!",
        type: "text",
      },
      {
        text: "do that!",
        type: "text",
      },
    ],
  });
  console.dir(result);
}

main();
