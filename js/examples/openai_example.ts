#!/usr/bin/env npx tsx

import OpenAI from "openai";
import { wrapOpenAI } from "braintrust";

// Create and wrap OpenAI client with Braintrust
const openai = wrapOpenAI(new OpenAI());

async function main() {
  const result = await openai.chat.completions.create({
    messages: [
      {
        role: "user",
        content: "Hello! Can you tell me a joke?",
      },
    ],
    model: "gpt-3.5-turbo",
    max_tokens: 100,
  });
  console.dir(result);
}

main().catch(console.error);
