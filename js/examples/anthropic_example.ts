#!/usr/bin/env tsx

import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic, initLogger } from "braintrust";

initLogger({
  projectName: "anthropic-typescript-example",
});

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
  });
  console.dir(result);
}

main();
