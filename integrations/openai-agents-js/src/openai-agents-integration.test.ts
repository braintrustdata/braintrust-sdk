import {
  test,
  assert,
  beforeEach,
  beforeAll,
  afterEach,
  describe,
} from "vitest";
import { OpenAIAgentsTraceProcessor } from "./index";
import { z } from "zod";

// Import necessary types and functions from braintrust
import {
  _exportsForTestingOnly,
  initLogger,
  Logger,
  TestBackgroundLogger,
  Span as BraintrustSpan,
} from "braintrust";

// Test helper functions for backward compatibility
function getSpansMap(
  processor: OpenAIAgentsTraceProcessor,
): Map<string, BraintrustSpan> {
  const spans = new Map<string, BraintrustSpan>();
  for (const [traceId, traceData] of processor._traceSpans) {
    spans.set(traceId, traceData.rootSpan);
    for (const [spanId, span] of traceData.childSpans) {
      spans.set(`${traceId}:${spanId}`, span);
    }
  }
  return spans;
}

function getTraceMetadataMap(processor: OpenAIAgentsTraceProcessor) {
  const metadata = new Map();
  for (const [traceId, traceData] of processor._traceSpans) {
    metadata.set(traceId, traceData.metadata);
  }
  return metadata;
}

const TEST_SUITE_OPTIONS = { timeout: 30000, retry: 3 };

// Simple test model for OpenAI Agents
const TEST_MODEL = "gpt-4o-mini";

// Node.js configuration is automatically handled when importing from braintrust

// Test with real @openai/agents SDK calls (requires OPENAI_API_KEY)
describe(
  "OpenAI Agents tracing processor integration tests",
  TEST_SUITE_OPTIONS,
  () => {
    let backgroundLogger: TestBackgroundLogger;
    let _logger: Logger<false>;
    let Agent: any;
    let run: any;
    let tool: any;
    let setTraceProcessors: any;
    let addTraceProcessor: any;
    let setTracingDisabled: any;

    beforeAll(async () => {
      await _exportsForTestingOnly.simulateLoginForTests();

      // Dynamically import @openai/agents to handle cases where it's not available
      try {
        const agentsModule = await import("@openai/agents");
        Agent = agentsModule.Agent;
        run = agentsModule.run;
        tool = agentsModule.tool;
        setTraceProcessors = agentsModule.setTraceProcessors;
        addTraceProcessor = agentsModule.addTraceProcessor;
        setTracingDisabled = agentsModule.setTracingDisabled;
      } catch (error) {
        console.warn(
          "@openai/agents not available, skipping integration tests",
        );
      }
    });

    beforeEach(() => {
      backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
      _logger = initLogger({
        projectName: "openai-agents.test.ts",
        projectId: "test-openai-agents",
      });
    });

    afterEach(() => {
      if (_logger) {
        _logger.flush();
      }
      if (setTraceProcessors) {
        setTraceProcessors([]);
      }
      _exportsForTestingOnly.clearTestBackgroundLogger();
    });

    test("OpenAIAgentsTraceProcessor is instantiable", () => {
      const processor = new OpenAIAgentsTraceProcessor({
        logger: _logger as any,
      });
      assert.ok(processor);

      // Test methods exist
      assert.ok(typeof processor.onTraceStart === "function");
      assert.ok(typeof processor.onTraceEnd === "function");
      assert.ok(typeof processor.onSpanStart === "function");
      assert.ok(typeof processor.onSpanEnd === "function");
      assert.ok(typeof processor.shutdown === "function");
      assert.ok(typeof processor.forceFlush === "function");
    });

    test("simple agent run with tracing", async (context) => {
      assert.lengthOf(await backgroundLogger.drain(), 0);

      // Set up the OpenAI Agents tracing processor
      const processor = new OpenAIAgentsTraceProcessor({
        logger: _logger as any,
      });

      setTracingDisabled(false);
      addTraceProcessor(processor);

      try {
        // Create a simple agent
        const agent = new Agent({
          name: "test-agent",
          model: TEST_MODEL,
          instructions: "You are a helpful assistant. Be concise.",
        });

        // Run the agent with a simple prompt using the run() function
        const result = await run(agent, "What is 2+2? Just give the number.");
        assert.ok(result);
        assert.ok(result.finalOutput);

        // Verify spans were created
        const spans = await backgroundLogger.drain();
        assert.isTrue(
          spans.length > 0,
          "Expected at least one span to be created",
        );

        // Verify span structure
        const traceSpan = spans.find(
          (s: any) => s.span_attributes?.type === "task",
        );
        assert.ok(
          traceSpan,
          "Expected to find a task-type span for the agent trace",
        );
        assert.equal((traceSpan as any).span_attributes.name, "Agent workflow");
      } finally {
        processor.shutdown();
      }
    });

    test("agent with function calling", async (context) => {
      assert.lengthOf(await backgroundLogger.drain(), 0);

      const processor = new OpenAIAgentsTraceProcessor({
        logger: _logger as any,
      });

      setTracingDisabled(false);
      addTraceProcessor(processor);

      try {
        // Create a tool using the proper tool() helper
        const getWeatherTool = tool({
          name: "get_weather",
          description: "Get the current weather for a city",
          parameters: z.object({ city: z.string() }),
          execute: async (input: { city: string }) => {
            return `The weather in ${input.city} is sunny with temperature 72°F`;
          },
        });

        // Create agent with the tool
        const agent = new Agent({
          name: "weather-agent",
          model: TEST_MODEL,
          instructions:
            "You can get the weather for any city. Use the get_weather tool when asked about weather.",
          tools: [getWeatherTool],
        });

        const result = await run(agent, "What's the weather in San Francisco?");
        assert.ok(result);
        assert.ok(result.finalOutput);

        // Verify spans were created
        const spans = await backgroundLogger.drain();
        assert.isTrue(spans.length > 0);

        // Verify span structure
        const taskSpans = spans.filter(
          (s: any) => s.span_attributes?.type === "task",
        );
        assert.isTrue(taskSpans.length > 0, "Expected task-type spans");

        // Verify tool spans if function calling occurred
        const toolSpans = spans.filter(
          (s: any) => s.span_attributes?.type === "tool",
        );
        if (toolSpans.length > 0) {
          const toolSpan = toolSpans[0] as any;
          assert.ok(
            toolSpan.span_attributes.name,
            "Tool span should have a name",
          );
        }
      } finally {
        processor.shutdown();
      }
    });

    test("Cleanup behavior - traces are cleaned up properly and orphaned spans are handled gracefully", async () => {
      const processor = new OpenAIAgentsTraceProcessor({
        logger: _logger as any,
      });

      const trace: any = {
        traceId: "test-trace-cleanup",
        name: "cleanup-test",
        metadata: {},
      };

      // Start trace and verify it's stored
      await processor.onTraceStart(trace);
      assert.isTrue(
        getSpansMap(processor).has(trace.traceId),
        "Root span should be stored",
      );
      assert.isTrue(
        getTraceMetadataMap(processor).has(trace.traceId),
        "Trace metadata should be stored",
      );

      // Add a child span
      const span = {
        spanId: "test-span-cleanup",
        traceId: trace.traceId,
        spanData: { type: "agent", name: "test-agent" },
        error: null,
      } as any;

      await processor.onSpanStart(span);
      const childSpanKey = `${trace.traceId}:${span.spanId}`;
      assert.isTrue(
        getSpansMap(processor).has(childSpanKey),
        "Child span should be stored",
      );

      // End the child span first
      await processor.onSpanEnd(span);

      // End the trace normally
      await processor.onTraceEnd(trace);

      // Verify cleanup happened
      assert.isFalse(
        getSpansMap(processor).has(trace.traceId),
        "Root span should be removed",
      );
      assert.isFalse(
        getTraceMetadataMap(processor).has(trace.traceId),
        "Trace metadata should be removed",
      );

      // Test that operations with orphaned spans are handled gracefully
      const orphanedSpan = {
        spanId: "orphaned-span",
        traceId: "test-trace-cleanup", // Same traceId but trace is now gone
        spanData: { type: "agent", name: "orphaned" },
        error: null,
      } as any;

      // These should be no-ops and not throw
      await processor.onSpanStart(orphanedSpan);
      await processor.onSpanEnd(orphanedSpan);

      // Verify the orphaned operations didn't create any trace data
      assert.isFalse(
        getSpansMap(processor).has("test-trace-cleanup"),
        "Orphaned operations shouldn't recreate root span",
      );
      assert.isFalse(
        getTraceMetadataMap(processor).has("test-trace-cleanup"),
        "Orphaned operations shouldn't recreate metadata",
      );
      assert.equal(
        getSpansMap(processor).size,
        0,
        "No spans should exist after cleanup",
      );
      assert.equal(
        getTraceMetadataMap(processor).size,
        0,
        "No metadata should exist after cleanup",
      );
    });

    test("LRU eviction behavior - oldest traces are evicted when maxTraces is exceeded", async () => {
      // Use a small maxTraces for fast testing
      const maxTraces = 3;
      const processor = new OpenAIAgentsTraceProcessor({ maxTraces });

      // Create traces up to the limit
      const traces: any[] = [];
      for (let i = 0; i < maxTraces; i++) {
        const trace = {
          traceId: `test-trace-${i}`,
          name: `test-${i}`,
          metadata: {},
        } as any;
        traces.push(trace);
        await processor.onTraceStart(trace);
      }

      // Verify all traces are stored
      assert.equal(
        getTraceMetadataMap(processor).size,
        maxTraces,
        "All trace metadata should be stored",
      );
      assert.isTrue(
        getSpansMap(processor).has("test-trace-0"),
        "First trace root span should exist",
      );
      assert.isTrue(
        getSpansMap(processor).has("test-trace-1"),
        "Second trace root span should exist",
      );
      assert.isTrue(
        getSpansMap(processor).has("test-trace-2"),
        "Third trace root span should exist",
      );

      // Add one more trace - this should trigger LRU eviction
      const newTrace = {
        traceId: "test-trace-new",
        name: "test-new",
        metadata: {},
      } as any;
      await processor.onTraceStart(newTrace);

      // Metadata should still be at max size
      assert.equal(
        getTraceMetadataMap(processor).size,
        maxTraces,
        "Metadata should remain at max size after eviction",
      );

      // First trace should be evicted, new trace should exist
      assert.isFalse(
        getSpansMap(processor).has("test-trace-0"),
        "First (oldest) trace should be evicted",
      );
      assert.isFalse(
        getTraceMetadataMap(processor).has("test-trace-0"),
        "First trace metadata should be evicted",
      );
      assert.isTrue(
        getSpansMap(processor).has("test-trace-new"),
        "New trace should exist",
      );
      assert.isTrue(
        getTraceMetadataMap(processor).has("test-trace-new"),
        "New trace metadata should exist",
      );
      assert.isTrue(
        getSpansMap(processor).has("test-trace-1"),
        "Second trace should still exist",
      );
      assert.isTrue(
        getSpansMap(processor).has("test-trace-2"),
        "Third trace should still exist",
      );
    });

    test("Span hierarchy and storage validation - ensures proper parent-child relationships", async () => {
      const processor = new OpenAIAgentsTraceProcessor({
        logger: _logger as any,
      });

      // Create a trace
      const trace: any = {
        traceId: "test-hierarchy-trace",
        name: "hierarchy-test",
        metadata: {},
      };

      await processor.onTraceStart(trace);
      assert.isTrue(
        getSpansMap(processor).has(trace.traceId),
        "Root span should be stored by traceId",
      );
      assert.isTrue(
        getTraceMetadataMap(processor).has(trace.traceId),
        "Trace metadata should be stored",
      );

      // Create parent span (no parentId, should attach to root)
      const parentSpan = {
        spanId: "parent-span-1",
        traceId: trace.traceId,
        parentId: null,
        spanData: { type: "agent", name: "parent-agent" },
        error: null,
      } as any;

      await processor.onSpanStart(parentSpan);
      const parentSpanKey = `${trace.traceId}:${parentSpan.spanId}`;
      assert.isTrue(
        getSpansMap(processor).has(parentSpanKey),
        "Parent span should be stored with composite key",
      );

      // Create child span (with parentId, should attach to parent)
      const childSpan = {
        spanId: "child-span-1",
        traceId: trace.traceId,
        parentId: parentSpan.spanId,
        spanData: {
          type: "function",
          name: "child-function",
          input: "test input",
          output: "test output",
        },
        error: null,
      } as any;

      await processor.onSpanStart(childSpan);
      const childSpanKey = `${trace.traceId}:${childSpan.spanId}`;
      assert.isTrue(
        getSpansMap(processor).has(childSpanKey),
        "Child span should be stored with composite key",
      );

      // Create grandchild span
      const grandchildSpan = {
        spanId: "grandchild-span-1",
        traceId: trace.traceId,
        parentId: childSpan.spanId,
        spanData: {
          type: "generation",
          name: "grandchild-generation",
          input: [{ role: "user", content: "test" }],
          output: [{ role: "assistant", content: "response" }],
        },
        error: null,
      } as any;

      await processor.onSpanStart(grandchildSpan);
      const grandchildSpanKey = `${trace.traceId}:${grandchildSpan.spanId}`;
      assert.isTrue(
        getSpansMap(processor).has(grandchildSpanKey),
        "Grandchild span should be stored with composite key",
      );

      // Verify we have the expected number of spans
      const allSpanKeys = Array.from(getSpansMap(processor).keys());
      const traceSpans = allSpanKeys.filter((key) =>
        key.startsWith(trace.traceId),
      );
      assert.equal(
        traceSpans.length,
        4,
        "Should have 4 spans total: 1 root + 3 child spans",
      );

      // End spans in reverse order (grandchild -> child -> parent)
      await processor.onSpanEnd(grandchildSpan);
      assert.isFalse(
        getSpansMap(processor).has(grandchildSpanKey),
        "Grandchild span should be removed after ending",
      );

      await processor.onSpanEnd(childSpan);
      assert.isFalse(
        getSpansMap(processor).has(childSpanKey),
        "Child span should be removed after ending",
      );

      await processor.onSpanEnd(parentSpan);
      assert.isFalse(
        getSpansMap(processor).has(parentSpanKey),
        "Parent span should be removed after ending",
      );

      // Root span should still exist
      assert.isTrue(
        getSpansMap(processor).has(trace.traceId),
        "Root span should still exist",
      );
      assert.isTrue(
        getTraceMetadataMap(processor).has(trace.traceId),
        "Trace metadata should still exist",
      );

      // End the trace
      await processor.onTraceEnd(trace);
      assert.isFalse(
        getSpansMap(processor).has(trace.traceId),
        "Root span should be removed after trace end",
      );
      assert.isFalse(
        getTraceMetadataMap(processor).has(trace.traceId),
        "Trace metadata should be removed after trace end",
      );

      // Verify all spans are cleaned up
      const remainingSpans = Array.from(getSpansMap(processor).keys()).filter(
        (key) => key.startsWith(trace.traceId),
      );
      assert.equal(
        remainingSpans.length,
        0,
        "No spans should remain for this trace",
      );
    });
  },
);
