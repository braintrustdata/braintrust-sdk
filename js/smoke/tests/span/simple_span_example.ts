/**
This test is a simple test to verify the braintrust package can be used to send spans to the braintrust API.

This test is not written as a vitest because it needs to be run as CommonJS and ESM. Vitest does not support running both modes.
**/
import assert from "node:assert/strict";

import { initLogger, _exportsForTestingOnly } from "braintrust";
import { runSpanSmokeTest } from "./span_test_helper";

async function main() {
  const spans = await runSpanSmokeTest({
    initLogger,
    testingExports: _exportsForTestingOnly,
    projectName: "otel-simple-example",
  });

  if (spans.length === 0) {
    throw new Error("No spans were captured by the background logger");
  }

  const spanEvent = spans[0]!;

  assert.equal(spanEvent.input, "What is the capital of France?");
  assert.equal(spanEvent.output, "Paris");
  assert.equal(spanEvent.expected, "Paris");

  console.log("Simple span example passed");
}

main().catch((error) => {
  console.log("Simple span example failed:", error);
  process.exitCode = 1;
});
