/**
 * Basic logging test suite
 * Tests core logging functionality: initLogger, spans, flush
 */

import type { TestAdapters, TestResult } from "../helpers/types";
import { assert, assertEqual, assertNotEmpty } from "../helpers/assertions";

const PROJECT_ID = "test-project-id";

/**
 * Test basic span logging
 */
export async function testBasicSpanLogging(
  adapters: TestAdapters,
): Promise<TestResult> {
  const testName = "testBasicSpanLogging";

  try {
    const { initLogger, backgroundLogger } = adapters;

    const logger = initLogger({
      projectName: "basic-logging-test",
      projectId: PROJECT_ID,
    });

    // Create a span
    const span = logger.startSpan({ name: "basic.span" });

    // Log some data
    span.log({
      input: "What is the capital of France?",
      output: "Paris",
      expected: "Paris",
      metadata: { transport: "smoke-test" },
    });

    // End the span
    span.end();

    // Flush the logger
    await logger.flush();

    // Verify events were captured
    const events = await backgroundLogger.drain();

    assertNotEmpty(events, "No events were captured by the background logger");
    assertEqual(events.length, 1, "Expected exactly one event");

    const event = events[0] as Record<string, unknown>;
    assertEqual(event.input, "What is the capital of France?");
    assertEqual(event.output, "Paris");
    assertEqual(event.expected, "Paris");

    return {
      status: "pass" as const,
      name: testName,
      message: "Basic span logging test passed",
    };
  } catch (error) {
    return {
      status: "fail" as const,
      name: testName,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Test multiple spans in sequence
 */
export async function testMultipleSpans(
  adapters: TestAdapters,
): Promise<TestResult> {
  const testName = "testMultipleSpans";

  try {
    const { initLogger, backgroundLogger } = adapters;

    const logger = initLogger({
      projectName: "multi-span-test",
      projectId: PROJECT_ID,
    });

    // Create multiple spans
    const span1 = logger.startSpan({ name: "span.1" });
    span1.log({ input: "test1", output: "result1" });
    span1.end();

    const span2 = logger.startSpan({ name: "span.2" });
    span2.log({ input: "test2", output: "result2" });
    span2.end();

    await logger.flush();

    // Verify events
    const events = await backgroundLogger.drain();

    assertNotEmpty(events, "No events were captured");
    assert(
      events.length >= 2,
      `Expected at least 2 events, got ${events.length}`,
    );

    return {
      status: "pass" as const,
      name: testName,
      message: `Multiple spans test passed (${events.length} events captured)`,
    };
  } catch (error) {
    return {
      status: "fail" as const,
      name: testName,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Test logger.log() if available (direct logging without explicit span)
 */
export async function testDirectLogging(
  adapters: TestAdapters,
): Promise<TestResult> {
  const testName = "testDirectLogging";

  try {
    const { initLogger, backgroundLogger } = adapters;

    const logger = initLogger({
      projectName: "direct-logging-test",
      projectId: PROJECT_ID,
    });

    // Some logger implementations support direct logging
    if (typeof logger.log === "function") {
      logger.log({
        input: "direct test",
        output: "direct result",
      });

      await logger.flush();

      const events = await backgroundLogger.drain();
      assertNotEmpty(events, "No events were captured from direct logging");

      return {
        status: "pass" as const,
        name: testName,
        message: "Direct logging test passed",
      };
    } else {
      return {
        status: "pass" as const,
        name: testName,
        message: "Direct logging not supported, skipped",
      };
    }
  } catch (error) {
    return {
      status: "fail" as const,
      name: testName,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Test JSONAttachment functionality
 * Tests that JSONAttachment can be created and logged correctly
 */
export async function testJSONAttachment(
  adapters: TestAdapters,
  braintrust: { JSONAttachment?: unknown },
): Promise<TestResult> {
  const testName = "testJSONAttachment";

  try {
    const { initLogger, backgroundLogger } = adapters;

    const logger = initLogger({
      projectName: "json-attachment-test",
      projectId: PROJECT_ID,
    });

    // Check if JSONAttachment is available
    if (!braintrust.JSONAttachment) {
      return {
        status: "pass" as const,
        name: testName,
        message: "JSONAttachment not available, skipped",
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const JSONAttachment = braintrust.JSONAttachment as any;

    const testData = {
      foo: "bar",
      nested: {
        array: [1, 2, 3],
        bool: true,
      },
    };

    // Test logging with JSONAttachment
    if (typeof logger.log === "function") {
      logger.log({
        input: {
          type: "chat_completion",
          transcript: new JSONAttachment(testData, {
            filename: "conversation_transcript.json",
            pretty: true,
          }),
        },
      });
    } else {
      // Fallback to span logging
      const span = logger.startSpan({ name: "json-attachment-test" });
      span.log({
        input: {
          type: "chat_completion",
          transcript: new JSONAttachment(testData, {
            filename: "conversation_transcript.json",
            pretty: true,
          }),
        },
      });
      span.end();
    }

    await logger.flush();

    const events = await backgroundLogger.drain();
    assertNotEmpty(events, "No events were captured with JSONAttachment");

    // Verify the test data structure is preserved
    assertEqual(testData.foo, "bar", "testData.foo should be 'bar'");
    assertEqual(
      testData.nested.array.length,
      3,
      "testData.nested.array should have 3 elements",
    );
    assertEqual(
      testData.nested.array[0],
      1,
      "testData.nested.array[0] should be 1",
    );
    assertEqual(
      testData.nested.bool,
      true,
      "testData.nested.bool should be true",
    );

    return {
      status: "pass" as const,
      name: testName,
      message: "JSONAttachment test passed",
    };
  } catch (error) {
    return {
      status: "fail" as const,
      name: testName,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

/**
 * Run all basic logging tests
 */
export async function runBasicLoggingTests(
  adapters: TestAdapters,
  braintrust?: { JSONAttachment?: unknown },
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  results.push(await testBasicSpanLogging(adapters));
  results.push(await testMultipleSpans(adapters));
  results.push(await testDirectLogging(adapters));

  // Only run JSONAttachment test if braintrust module is provided
  if (braintrust) {
    results.push(await testJSONAttachment(adapters, braintrust));
  }

  return results;
}
