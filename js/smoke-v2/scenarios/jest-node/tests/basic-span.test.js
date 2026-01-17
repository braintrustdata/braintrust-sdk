const {
  initLogger,
  JSONAttachment,
  _exportsForTestingOnly,
} = require("braintrust");

test("basic span logging works in Jest", async () => {
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

  expect(typeof logger.startSpan).toBe("function");

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

  await _exportsForTestingOnly.clearTestBackgroundLogger();
  await _exportsForTestingOnly.simulateLogoutForTests();
});
