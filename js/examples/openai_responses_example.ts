#!/usr/bin/env tsx

import OpenAI from "openai";
import { wrapOpenAI, initLogger } from "braintrust";

initLogger({ projectName: "typescript-examples" });

const client = wrapOpenAI(new OpenAI());

async function main() {
  console.log("Call responses.create");
  const response = await client.responses.create({
    model: "gpt-4o-mini",
    instructions: "It is the year 2000",
    input: "What is the best book?",
  });

  console.log(response.output_text);

  console.log("Call responses.stream");
  const stream = await client.responses.create({
    model: "gpt-4o-mini",
    input: "What are 5 books I should read?",
    stream: true,
  });

  for await (const event of stream) {
    console.log(event);
  }
}

main();
