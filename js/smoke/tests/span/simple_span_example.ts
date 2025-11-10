/**
This test is a simple test to verify the braintrust package can be used to send spans to the braintrust API.

This test is not written as a vitest because it needs to be run as CommonJS and ESM. Vitest does not support running both modes.
**/
import assert from "node:assert/strict";

import {
  initLogger,
  TestBackgroundLogger,
  _exportsForTestingOnly,
} from "braintrust";

async function main() {
  _exportsForTestingOnly.setInitialTestState();
  await _exportsForTestingOnly.simulateLoginForTests();

  const backgroundLogger: TestBackgroundLogger =
    _exportsForTestingOnly.useTestBackgroundLogger();

  const logger = initLogger({
    projectName: "otel-simple-example",
    projectId: "test-project-id",
  });

  const span = logger.startSpan({ name: "logger.simple" });
  span.log({
    input: "What is the capital of France?",
    output: "Paris",
    expected: "Paris",
    metadata: { model: "gpt-4o-mini" },
  });
  span.end();

  await logger.flush();

  const spans = await backgroundLogger.drain();
  try {
    assert.ok(
      spans.length > 0,
      "No spans were captured by the background logger",
    );

    const spanEvent = spans[0];
    assert.equal(spanEvent.input, "What is the capital of France?");
    assert.equal(spanEvent.output, "Paris");
    assert.equal(spanEvent.expected, "Paris");

    console.log("Simple span example passed");
  } finally {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  }
}

main().catch((error) => {
  console.log("Simple span example failed:", error);
  process.exitCode = 1;
});
