#!/usr/bin/env tsx

import { traced, initLogger } from "braintrust";

initLogger({ projectName: "typescript-examples" });

async function main() {
  return traced(async (span) => {
    console.log("this function is traced");
    span.log({
      input: "hello",
      output: "world",
      metrics: {
        tokens: 10,
      },
      metadata: {
        version: "0.1.2",
      },
    });
  });
}

main().catch(console.error);
