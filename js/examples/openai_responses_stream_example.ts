#!/usr/bin/env tsx

import OpenAI from "openai";
import { wrapOpenAI, initLogger } from "braintrust";

initLogger({ projectName: "typescript-examples" });

const openai = wrapOpenAI(new OpenAI());

async function main() {
  const runner = openai.responses
    .stream({
      model: "gpt-4o-2024-08-06",
      input: "solve 8x + 31 = 2",
    })
    .on("event", (event) => console.log(event))
    .on("response.output_text.delta", (diff) =>
      process.stdout.write(diff.delta),
    );

  for await (const event of runner) {
    console.log("event", event);
  }

  const result = await runner.finalResponse();
  console.log(result);
}

main();
