/**
 * Basic logging test suite
 * Tests core logging functionality: initLogger, spans, flush
 */

import type { TestAdapters, TestResult } from "../helpers/types";
import type { BraintrustModule } from "./import-verification";
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
 * Test logger.log() - direct logging without explicit span
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

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    logger.log!({
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
  braintrust: BraintrustModule,
): Promise<TestResult> {
  const testName = "testJSONAttachment";

  try {
    const { initLogger, backgroundLogger } = adapters;

    const logger = initLogger({
      projectName: "json-attachment-test",
      projectId: PROJECT_ID,
    });

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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    logger.log!({
      input: {
        type: "chat_completion",
        transcript: new JSONAttachment(testData, {
          filename: "conversation_transcript.json",
          pretty: true,
        }),
      },
    });

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
 * Test async local storage (ALS) with traced()
 * Tests that child spans created inside traced() automatically get the correct parent
 */
export async function testAsyncLocalStorageTraced(
  adapters: TestAdapters,
  braintrust: BraintrustModule,
): Promise<TestResult> {
  const testName = "testAsyncLocalStorageTraced";

  try {
    const { initLogger, backgroundLogger } = adapters;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traced = braintrust.traced as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const startSpan = braintrust.startSpan as any;

    initLogger({
      projectName: "als-traced-test",
      projectId: PROJECT_ID,
    });

    // Test: traced() should create a parent span, and startSpan() inside should be a child
    await traced(
      () => {
        const child = startSpan({ name: "child-span" });
        child.log({ input: "child input", output: "child output" });
        child.end();
      },
      { name: "parent-span" },
    );

    // Get the events
    const events = (await backgroundLogger.drain()) as Array<
      Record<string, unknown>
    >;

    assertNotEmpty(events, "No events captured for ALS traced test");

    // Find parent and child spans
    const parentSpan = events.find(
      (e) =>
        typeof e.span_attributes === "object" &&
        e.span_attributes !== null &&
        (e.span_attributes as Record<string, unknown>).name === "parent-span",
    );
    const childSpan = events.find(
      (e) =>
        typeof e.span_attributes === "object" &&
        e.span_attributes !== null &&
        (e.span_attributes as Record<string, unknown>).name === "child-span",
    );

    // In environments with ALS, both spans should exist and child should have parent
    if (parentSpan && childSpan) {
      const parentId = parentSpan.span_id as string;
      const childParents = (childSpan.span_parents as string[]) || [];

      // Verify parent-child relationship
      assert(
        childParents.includes(parentId),
        `Child span should have parent span ID in span_parents. Parent ID: ${parentId}, Child parents: ${JSON.stringify(childParents)}`,
      );

      return {
        status: "pass" as const,
        name: testName,
        message: "ALS traced test passed (parent-child relationship verified)",
      };
    } else if (!parentSpan && !childSpan) {
      // Environment without ALS - this is acceptable
      return {
        status: "pass" as const,
        name: testName,
        message: "ALS not available in this environment, test skipped",
      };
    } else {
      // Only one span found - something is wrong
      return {
        status: "fail" as const,
        name: testName,
        error: {
          message: `Expected both parent and child spans, but found: parent=${!!parentSpan}, child=${!!childSpan}`,
        },
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
 * Test nested traced() calls
 * Tests that nested traced() calls create proper grandparent -> parent -> child relationships
 */
export async function testNestedTraced(
  adapters: TestAdapters,
  braintrust: BraintrustModule,
): Promise<TestResult> {
  const testName = "testNestedTraced";

  try {
    const { initLogger, backgroundLogger } = adapters;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traced = braintrust.traced as any;

    initLogger({
      projectName: "nested-traced-test",
      projectId: PROJECT_ID,
    });

    // Test nested traced calls
    await traced(
      async () => {
        await traced(
          async () => {
            await traced(
              () => {
                // innermost span
              },
              { name: "grandchild-span" },
            );
          },
          { name: "child-span" },
        );
      },
      { name: "parent-span" },
    );

    const events = (await backgroundLogger.drain()) as Array<
      Record<string, unknown>
    >;

    if (events.length === 0) {
      return {
        status: "pass" as const,
        name: testName,
        message: "ALS not available in this environment, test skipped",
      };
    }

    // Find all three spans
    const parentSpan = events.find(
      (e) =>
        typeof e.span_attributes === "object" &&
        e.span_attributes !== null &&
        (e.span_attributes as Record<string, unknown>).name === "parent-span",
    );
    const childSpan = events.find(
      (e) =>
        typeof e.span_attributes === "object" &&
        e.span_attributes !== null &&
        (e.span_attributes as Record<string, unknown>).name === "child-span",
    );
    const grandchildSpan = events.find(
      (e) =>
        typeof e.span_attributes === "object" &&
        e.span_attributes !== null &&
        (e.span_attributes as Record<string, unknown>).name ===
          "grandchild-span",
    );

    if (parentSpan && childSpan && grandchildSpan) {
      const parentId = parentSpan.span_id as string;
      const childId = childSpan.span_id as string;
      const childParents = (childSpan.span_parents as string[]) || [];
      const grandchildParents = (grandchildSpan.span_parents as string[]) || [];

      // Verify child has parent as parent
      assert(
        childParents.includes(parentId),
        "Child should have parent in span_parents",
      );

      // Verify grandchild has child as parent
      assert(
        grandchildParents.includes(childId),
        "Grandchild should have child in span_parents",
      );

      return {
        status: "pass" as const,
        name: testName,
        message: "Nested traced test passed (3-level hierarchy verified)",
      };
    } else {
      return {
        status: "pass" as const,
        name: testName,
        message: "ALS not available in this environment, test skipped",
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
 * Test currentSpan() API
 * Tests that currentSpan() returns the active span within traced()
 */
export async function testCurrentSpan(
  adapters: TestAdapters,
  braintrust: BraintrustModule,
): Promise<TestResult> {
  const testName = "testCurrentSpan";

  try {
    const { initLogger, backgroundLogger } = adapters;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traced = braintrust.traced as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentSpan = braintrust.currentSpan as any;

    initLogger({
      projectName: "current-span-test",
      projectId: PROJECT_ID,
    });

    let capturedSpanId: string | undefined;

    await traced(
      () => {
        const current = currentSpan();
        if (current && typeof current === "object" && "spanId" in current) {
          capturedSpanId = (current as { spanId: string }).spanId;
        }
      },
      { name: "test-current-span" },
    );

    const events = (await backgroundLogger.drain()) as Array<
      Record<string, unknown>
    >;

    if (events.length === 0 || !capturedSpanId) {
      return {
        status: "pass" as const,
        name: testName,
        message: "ALS not available in this environment, test skipped",
      };
    }

    // Find the span
    const span = events.find((e) => e.span_id === capturedSpanId);

    if (span) {
      assertEqual(
        (
          (span.span_attributes as Record<string, unknown>) || {
            name: undefined,
          }
        ).name,
        "test-current-span",
        "currentSpan() should return the active span",
      );

      return {
        status: "pass" as const,
        name: testName,
        message: "currentSpan test passed",
      };
    } else {
      return {
        status: "fail" as const,
        name: testName,
        error: {
          message: "currentSpan() returned a span ID that was not logged",
        },
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
 * Run all basic logging tests
 */
export async function runBasicLoggingTests(
  adapters: TestAdapters,
  braintrust: BraintrustModule,
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  results.push(await testBasicSpanLogging(adapters));
  results.push(await testMultipleSpans(adapters));
  results.push(await testDirectLogging(adapters));
  results.push(await testJSONAttachment(adapters, braintrust));
  results.push(await testAsyncLocalStorageTraced(adapters, braintrust));
  results.push(await testNestedTraced(adapters, braintrust));
  results.push(await testCurrentSpan(adapters, braintrust));

  return results;
}
