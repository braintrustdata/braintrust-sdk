import { initLogger, JSONAttachment } from "braintrust";

test("simple_span_example runs successfully via Jest", async () => {
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
});
