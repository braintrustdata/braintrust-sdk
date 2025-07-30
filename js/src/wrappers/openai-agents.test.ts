import {
  test,
  assert,
  beforeEach,
  beforeAll,
  afterEach,
  describe,
} from "vitest";
import { configureNode } from "../node";
import {
  _exportsForTestingOnly,
  initLogger,
  Logger,
  TestBackgroundLogger,
} from "../logger";
import { BraintrustTracingProcessor } from "./openai-agents";
import { z } from "zod";

const TEST_SUITE_OPTIONS = { timeout: 30000, retry: 3 };

// Simple test model for OpenAI Agents
const TEST_MODEL = "gpt-4o-mini";

try {
  configureNode();
} catch {
  // FIXME[matt] have a better of way of initializing brainstrust state once per process.
}

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

    test("BraintrustTracingProcessor is instantiable", () => {
      const processor = new BraintrustTracingProcessor(_logger);
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
      if (
        !Agent ||
        !run ||
        !setTraceProcessors ||
        !process.env.OPENAI_API_KEY
      ) {
        context.skip();
        return;
      }

      assert.lengthOf(await backgroundLogger.drain(), 0);

      // Set up the Braintrust tracing processor
      const processor = new BraintrustTracingProcessor(_logger);

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

      const processor = new BraintrustTracingProcessor(_logger);

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
  },
);
