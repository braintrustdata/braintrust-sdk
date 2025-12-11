/**
This test is a simple test to verify the braintrust package can be used to send spans to the braintrust API.

This test is not written as a vitest because it needs to be run as CommonJS and ESM. Vitest does not support running both modes.
**/
import assert from "node:assert/strict";

import {
  initLogger,
  _exportsForTestingOnly,
  JSONAttachment,
  type BraintrustState,
} from "braintrust";

async function main() {
  // const spans = await runSpanSmokeTest({
  //   initLogger,
  //   testingExports: _exportsForTestingOnly,
  //   projectName: "otel-simple-example",
  // });

  // if (spans.length === 0) {
  //   throw new Error("No spans were captured by the background logger");
  // }

  // const spanEvent = spans[0]!;

  // assert.equal(spanEvent.input, "What is the capital of France?");
  // assert.equal(spanEvent.output, "Paris");
  // assert.equal(spanEvent.expected, "Paris");

  const logger = initLogger({
    projectName: "otel-simple-example",
    projectId: "otel-simple-example",
  });

  const testData = {
    foo: "bar",
    nested: {
      array: [1, 2, 3],
      bool: true,
    },
  };

  logger.log({
    input: {
      type: "chat_completion",
      transcript: new JSONAttachment(testData, {
        filename: "conversation_transcript.json",
        pretty: true,
      }),
    },
  });

  const span = logger.startSpan({ name: "test-span" });
  span.log({
    input: "What is the capital of France?",
    output: "Paris",
    expected: "Paris",
    metadata: { transport: "smoke-test" },
  });
  span.end();
  await logger.flush();

  console.log("Simple span example passed");
}

main().catch((error) => {
  console.log("Simple span example failed:", error);
  process.exitCode = 1;
});
