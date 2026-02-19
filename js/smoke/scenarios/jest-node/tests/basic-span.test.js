const {
  initLogger,
  JSONAttachment,
  _exportsForTestingOnly,
} = require("braintrust");

const { displayTestResults } = require("../../../shared/dist/index.js");

test("basic span logging works in Jest", async () => {
  const results = [];

  _exportsForTestingOnly.setInitialTestState();
  await _exportsForTestingOnly.simulateLoginForTests();

  const backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();

  const logger = initLogger({
    projectName: "jest-smoke-test",
    projectId: "jest-smoke-test",
  });

  const testData = {
    foo: "bar",
    nested: {
      array: [1, 2, 3],
      bool: true,
    },
  };

  // Test 1: Logger has startSpan function
  try {
    expect(typeof logger.startSpan).toBe("function");
    results.push({
      status: "pass",
      name: "Logger has startSpan function",
    });
  } catch (error) {
    results.push({
      status: "fail",
      name: "Logger has startSpan function",
      error: { message: error.message, stack: error.stack },
    });
  }

  // Test 2: Direct logging with JSONAttachment
  try {
    logger.log({
      input: {
        type: "chat_completion",
        transcript: new JSONAttachment(testData, {
          filename: "conversation_transcript.json",
          pretty: true,
        }),
      },
    });
    expect(testData.nested.array).toEqual([1, 2, 3]);
    results.push({
      status: "pass",
      name: "Direct logging with JSONAttachment",
    });
  } catch (error) {
    results.push({
      status: "fail",
      name: "Direct logging with JSONAttachment",
      error: { message: error.message, stack: error.stack },
    });
  }

  // Test 3: Span logging and capture
  try {
    const span = logger.startSpan({ name: "test-span" });
    span.log({
      input: "What is the capital of France?",
      output: "Paris",
      expected: "Paris",
      metadata: { transport: "smoke-test" },
    });
    span.end();

    await logger.flush();

    const spans = await backgroundLogger.drain();

    if (spans.length === 0) {
      throw new Error("No spans were captured by the background logger");
    }

    const spanEvent = spans.slice(-1)[0];

    expect(spanEvent.input).toEqual("What is the capital of France?");
    expect(spanEvent.output).toEqual("Paris");
    expect(spanEvent.expected).toEqual("Paris");

    results.push({
      status: "pass",
      name: "Span logging and capture",
    });
  } catch (error) {
    results.push({
      status: "fail",
      name: "Span logging and capture",
      error: { message: error.message, stack: error.stack },
    });
  }

  await _exportsForTestingOnly.clearTestBackgroundLogger();
  await _exportsForTestingOnly.simulateLogoutForTests();

  displayTestResults({
    scenarioName: "Jest Basic Span Test Results",
    results,
  });

  // Fail the Jest test if any results failed
  const failures = results.filter((r) => r.status === "fail");
  expect(failures).toHaveLength(0);
});
