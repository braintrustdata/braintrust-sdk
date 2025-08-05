import { test, assert, beforeEach, afterEach, describe } from "vitest";
import { OpenAIAgentsTracingProcessor } from "./index";
import {
  _exportsForTestingOnly,
  initLogger,
  Logger,
  TestBackgroundLogger,
} from "braintrust";
import type {
  SpanData,
  GenerationSpanData,
  FunctionSpanData,
  AgentSpanData,
  ResponseSpanData,
} from "@openai/agents-core/dist/tracing/spans";

// Type for trace override options
interface TraceOverrides {
  traceId?: string;
  name?: string;
  groupId?: string | null;
  metadata?: Record<string, any>;
}

// Type for span override options
interface SpanOverrides {
  spanId?: string;
  traceId?: string;
  parentId?: string | null;
  startedAt?: string;
  endedAt?: string;
  error?: { message: string; data?: Record<string, any> } | null;
  spanData?: SpanData;
}

// Mock realistic Trace and Span objects based on @openai/agents types
function createMockTrace(overrides: TraceOverrides = {}): any {
  const mockTrace = {
    type: "trace" as const,
    traceId: overrides.traceId ?? "trace-123",
    name: overrides.name ?? "Agent workflow",
    groupId: overrides.groupId ?? null,
    metadata: overrides.metadata ?? { agentName: "test-agent" },
    start: () => Promise.resolve(),
    end: () => Promise.resolve(),
    clone: () => createMockTrace(overrides),
    toJSON: () => null,
  };

  // Return as any to avoid TypeScript issues with private fields, but the interface is compatible
  return mockTrace as any;
}

function createMockSpan(overrides: SpanOverrides = {}): any {
  const defaultSpanData: GenerationSpanData = {
    type: "generation",
    input: [{ role: "user", content: "What is 2+2?" }],
    output: [{ role: "assistant", content: "4" }],
    model: "gpt-4o-mini",
    model_config: { temperature: 0.7 },
    usage: {
      prompt_tokens: 10,
      completion_tokens: 1,
      total_tokens: 11,
    },
  };

  const mockSpan = {
    type: "trace.span" as const,
    traceId: overrides.traceId ?? "trace-123",
    spanId: overrides.spanId ?? "span-456",
    parentId: overrides.parentId ?? null,
    startedAt: overrides.startedAt ?? "2024-01-01T00:00:01.000Z",
    endedAt: overrides.endedAt ?? "2024-01-01T00:00:01.000Z",
    error: overrides.error ?? null,
    previousSpan: undefined,
    start: () => {},
    end: () => {},
    setError: () => {},
    clone: () => createMockSpan(overrides),
    toJSON: () => null,
    spanData: overrides.spanData ?? defaultSpanData,
  };

  // Return as any to avoid TypeScript issues with private fields, but the interface is compatible
  return mockSpan as any;
}

describe("OpenAI Agents tracing processor integration tests", () => {
  let backgroundLogger: TestBackgroundLogger;
  let _logger: Logger<false>;

  beforeEach(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
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
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("OpenAIAgentsTracingProcessor is instantiable", () => {
    const processor = new OpenAIAgentsTracingProcessor(_logger as any);
    assert.ok(processor);

    // Test methods exist
    assert.ok(typeof processor.onTraceStart === "function");
    assert.ok(typeof processor.onTraceEnd === "function");
    assert.ok(typeof processor.onSpanStart === "function");
    assert.ok(typeof processor.onSpanEnd === "function");
    assert.ok(typeof processor.shutdown === "function");
    assert.ok(typeof processor.forceFlush === "function");
  });

  test("processor handles complete trace lifecycle with generation span", async () => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const processor = new OpenAIAgentsTracingProcessor(_logger as any);

    const mockTrace = createMockTrace();
    const mockSpan = createMockSpan();

    // Test complete lifecycle
    await processor.onTraceStart(mockTrace);
    await processor.onSpanStart(mockSpan);
    await processor.onSpanEnd(mockSpan);
    await processor.onTraceEnd(mockTrace);
    await processor.forceFlush();

    // Verify spans were created
    const spans = await backgroundLogger.drain();
    assert.isTrue(spans.length > 0, "Expected at least one span to be created");

    // Verify trace span structure
    const traceSpan = spans.find(
      (s: any) => s.span_attributes?.name === "Agent workflow",
    ) as any;
    assert.ok(traceSpan, "Expected to find trace span");
    assert.equal(traceSpan.span_attributes.type, "task");

    // Verify generation span structure
    const generationSpan = spans.find(
      (s: any) => s.span_attributes?.name === "Generation",
    ) as any;
    assert.ok(generationSpan, "Expected to find generation span");
    assert.equal(generationSpan.span_attributes.type, "llm");
    assert.deepEqual(generationSpan.input, [
      { role: "user", content: "What is 2+2?" },
    ]);
    assert.deepEqual(generationSpan.output, [
      { role: "assistant", content: "4" },
    ]);
    assert.equal(generationSpan.metadata.model, "gpt-4o-mini");
    assert.equal(generationSpan.metrics.tokens, 11);
    assert.equal(generationSpan.metrics.prompt_tokens, 10);
    assert.equal(generationSpan.metrics.completion_tokens, 1);
  });

  test("processor handles function span correctly", async () => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const processor = new OpenAIAgentsTracingProcessor(_logger as any);

    const mockTrace = createMockTrace();
    const mockFunctionSpan = createMockSpan({
      spanId: "span-function-789",
      spanData: {
        type: "function",
        name: "get_weather",
        input: "San Francisco",
        output: "The weather in San Francisco is sunny with temperature 72°F",
      } as FunctionSpanData,
    });

    await processor.onTraceStart(mockTrace);
    await processor.onSpanStart(mockFunctionSpan);
    await processor.onSpanEnd(mockFunctionSpan);
    await processor.onTraceEnd(mockTrace);
    await processor.forceFlush();

    const spans = await backgroundLogger.drain();

    // Verify function span
    const functionSpan = spans.find(
      (s: any) => s.span_attributes?.name === "get_weather",
    ) as any;
    assert.ok(functionSpan, "Expected to find function span");
    assert.equal(functionSpan.span_attributes.type, "tool");
    assert.equal(functionSpan.input, "San Francisco");
    assert.equal(
      functionSpan.output,
      "The weather in San Francisco is sunny with temperature 72°F",
    );
  });

  test("processor handles agent span correctly", async () => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const processor = new OpenAIAgentsTracingProcessor(_logger as any);

    const mockTrace = createMockTrace();
    const mockAgentSpan = createMockSpan({
      spanId: "span-agent-101",
      spanData: {
        type: "agent",
        name: "weather-agent",
        tools: ["get_weather", "get_forecast"],
        handoffs: ["support-agent"],
        output_type: "text",
      } as AgentSpanData,
    });

    await processor.onTraceStart(mockTrace);
    await processor.onSpanStart(mockAgentSpan);
    await processor.onSpanEnd(mockAgentSpan);
    await processor.onTraceEnd(mockTrace);
    await processor.forceFlush();

    const spans = await backgroundLogger.drain();

    // Verify agent span
    const agentSpan = spans.find(
      (s: any) => s.span_attributes?.name === "weather-agent",
    ) as any;
    assert.ok(agentSpan, "Expected to find agent span");
    assert.equal(agentSpan.span_attributes.type, "task");
    assert.deepEqual(agentSpan.metadata.tools, ["get_weather", "get_forecast"]);
    assert.deepEqual(agentSpan.metadata.handoffs, ["support-agent"]);
    assert.equal(agentSpan.metadata.output_type, "text");
  });

  test("processor handles response span with usage metrics", async () => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const processor = new OpenAIAgentsTracingProcessor(_logger as any);

    const mockTrace = createMockTrace();
    const mockResponseSpan = createMockSpan({
      spanId: "span-response-202",
      spanData: {
        type: "response",
        response_id: "resp-123",
        _input: "What's the weather?",
        _response: {
          output: "The weather is sunny",
          usage: {
            total_tokens: 25,
            input_tokens: 15,
            output_tokens: 10,
          },
          model: "gpt-4o-mini",
        },
      } as ResponseSpanData,
    });

    await processor.onTraceStart(mockTrace);
    await processor.onSpanStart(mockResponseSpan);
    await processor.onSpanEnd(mockResponseSpan);
    await processor.onTraceEnd(mockTrace);
    await processor.forceFlush();

    const spans = await backgroundLogger.drain();

    // Verify response span
    const responseSpan = spans.find(
      (s: any) => s.span_attributes?.name === "Response",
    ) as any;
    assert.ok(responseSpan, "Expected to find response span");
    assert.equal(responseSpan.span_attributes.type, "llm");
    assert.equal(responseSpan.input, "What's the weather?");
    assert.equal(responseSpan.output, "The weather is sunny");
    assert.equal(responseSpan.metrics.tokens, 25);
    assert.equal(responseSpan.metrics.prompt_tokens, 15);
    assert.equal(responseSpan.metrics.completion_tokens, 10);
  });

  test("processor handles spans with errors", async () => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const processor = new OpenAIAgentsTracingProcessor(_logger as any);

    const mockTrace = createMockTrace();
    const mockSpanWithError = createMockSpan({
      spanId: "span-error-404",
      error: {
        message: "API call failed",
        data: { statusCode: 500 },
      },
    });

    await processor.onTraceStart(mockTrace);
    await processor.onSpanStart(mockSpanWithError);
    await processor.onSpanEnd(mockSpanWithError);
    await processor.onTraceEnd(mockTrace);
    await processor.forceFlush();

    const spans = await backgroundLogger.drain();

    // Verify error was logged
    const errorSpan = spans.find(
      (s: any) => s.error?.message === "API call failed",
    ) as any;
    assert.ok(errorSpan, "Expected to find span with error");
    assert.deepEqual(errorSpan.error.data, { statusCode: 500 });
  });

  test("processor tracks first input and last output correctly", async () => {
    assert.lengthOf(await backgroundLogger.drain(), 0);

    const processor = new OpenAIAgentsTracingProcessor(_logger as any);

    const mockTrace = createMockTrace();

    // First span with input
    const firstSpan = createMockSpan({
      spanId: "span-first",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "First question" }],
        output: [{ role: "assistant", content: "First answer" }],
        model: "gpt-4o-mini",
      } as GenerationSpanData,
    });

    // Second span with different output
    const secondSpan = createMockSpan({
      spanId: "span-second",
      spanData: {
        type: "generation",
        input: [{ role: "user", content: "Second question" }],
        output: [{ role: "assistant", content: "Final answer" }],
        model: "gpt-4o-mini",
      } as GenerationSpanData,
    });

    await processor.onTraceStart(mockTrace);
    await processor.onSpanStart(firstSpan);
    await processor.onSpanEnd(firstSpan);
    await processor.onSpanStart(secondSpan);
    await processor.onSpanEnd(secondSpan);
    await processor.onTraceEnd(mockTrace);
    await processor.forceFlush();

    const spans = await backgroundLogger.drain();

    // Verify trace span has first input and last output
    const traceSpan = spans.find(
      (s: any) => s.span_attributes?.name === "Agent workflow",
    ) as any;
    assert.ok(traceSpan, "Expected to find trace span");
    assert.deepEqual(traceSpan.input, [
      { role: "user", content: "First question" },
    ]);
    assert.deepEqual(traceSpan.output, [
      { role: "assistant", content: "Final answer" },
    ]);
  });
});
