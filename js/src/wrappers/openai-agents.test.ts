import {
  test,
  assert,
  beforeEach,
  beforeAll,
  afterEach,
  describe,
  expect,
  vi,
} from "vitest";
import { configureNode } from "../node";
import {
  _exportsForTestingOnly,
  initLogger,
  Logger,
  TestBackgroundLogger,
} from "../logger";
import { BraintrustTracingProcessor } from "./openai-agents";

const TEST_SUITE_OPTIONS = { timeout: 10000, retry: 3 };

try {
  configureNode();
} catch {
  // FIXME[matt] have a better of way of initializing brainstrust state once per process.
}

// Test with mocked @openai/agents since it requires an API key
describe("OpenAI Agents tracing processor unit tests", TEST_SUITE_OPTIONS, () => {
  let backgroundLogger: TestBackgroundLogger;
  let _logger: Logger<false>;

  beforeAll(async () => {
    await _exportsForTestingOnly.simulateLoginForTests();
  });

  beforeEach(() => {
    backgroundLogger = _exportsForTestingOnly.useTestBackgroundLogger();
    _logger = initLogger({
      project: "test-openai-agents",
    });
  });

  afterEach(() => {
    if (_logger) {
      _logger.flush();
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

  test("handles trace lifecycle", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
      groupId: "group_456",
      metadata: { test: "value" },
    };

    // Should not throw
    processor.onTraceStart(mockTrace);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("handles span lifecycle with agent span", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    // Start trace first
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
      groupId: "group_456",
    };
    processor.onTraceStart(mockTrace);

    const mockAgentSpan = {
      type: "trace.span",
      spanId: "span_456",
      traceId: "trace_123",
      name: "Agent Span",
      spanData: {
        type: "agent",
        name: "Test Agent",
        tools: ["tool1", "tool2"],
        handoffs: ["handoff1"],
        outputType: "text",
      },
      startedAt: "2023-01-01T00:00:00Z",
      endedAt: "2023-01-01T00:00:05Z",
    };

    processor.onSpanStart(mockAgentSpan);
    processor.onSpanEnd(mockAgentSpan);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("handles generation span with metrics", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
    };
    processor.onTraceStart(mockTrace);

    const mockGenerationSpan = {
      type: "trace.span",
      spanId: "span_gen_789",
      traceId: "trace_123",
      spanData: {
        type: "generation",
        input: "What is the weather?",
        output: "The weather is sunny",
        model: "gpt-4o-mini",
        modelConfig: { temperature: 0.7 },
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25,
        },
      },
      startedAt: "2023-01-01T00:00:00Z",
      endedAt: "2023-01-01T00:00:02Z",
    };

    processor.onSpanStart(mockGenerationSpan);
    processor.onSpanEnd(mockGenerationSpan);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("handles function span", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
    };
    processor.onTraceStart(mockTrace);

    const mockFunctionSpan = {
      type: "trace.span",
      spanId: "span_func_101",
      traceId: "trace_123",
      spanData: {
        type: "function",
        name: "get_weather",
        input: { city: "San Francisco" },
        output: { weather: "sunny", temperature: 72 },
      },
    };

    processor.onSpanStart(mockFunctionSpan);
    processor.onSpanEnd(mockFunctionSpan);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("handles handoff span", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
    };
    processor.onTraceStart(mockTrace);

    const mockHandoffSpan = {
      type: "trace.span",
      spanId: "span_handoff_202",
      traceId: "trace_123",
      spanData: {
        type: "handoff",
        name: "Transfer to Weather Agent",
        fromAgent: "main_agent",
        toAgent: "weather_agent",
      },
    };

    processor.onSpanStart(mockHandoffSpan);
    processor.onSpanEnd(mockHandoffSpan);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("handles response span with usage metrics", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
    };
    processor.onTraceStart(mockTrace);

    const mockResponseSpan = {
      type: "trace.span",
      spanId: "span_response_303",
      traceId: "trace_123",
      spanData: {
        type: "response",
        input: "Tell me about the weather",
        response: {
          output: "The weather is currently sunny with a temperature of 72°F",
          metadata: { confidence: 0.95 },
          usage: {
            totalTokens: 30,
            inputTokens: 8,
            outputTokens: 22,
          },
        },
      },
      startedAt: "2023-01-01T00:00:00Z",
      endedAt: "2023-01-01T00:00:03Z",
    };

    processor.onSpanStart(mockResponseSpan);
    processor.onSpanEnd(mockResponseSpan);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("handles guardrail span", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
    };
    processor.onTraceStart(mockTrace);

    const mockGuardrailSpan = {
      type: "trace.span",
      spanId: "span_guard_404",
      traceId: "trace_123",
      spanData: {
        type: "guardrail",
        name: "Safety Check",
        triggered: true,
      },
    };

    processor.onSpanStart(mockGuardrailSpan);
    processor.onSpanEnd(mockGuardrailSpan);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("handles custom span", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
    };
    processor.onTraceStart(mockTrace);

    const mockCustomSpan = {
      type: "trace.span",
      spanId: "span_custom_505",
      traceId: "trace_123",
      spanData: {
        type: "custom",
        name: "Custom Operation",
        data: {
          operation: "complex_calculation",
          result: 42,
          metadata: { version: "1.0" },
        },
      },
    };

    processor.onSpanStart(mockCustomSpan);
    processor.onSpanEnd(mockCustomSpan);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("handles span with error", () => {
    const processor = new BraintrustTracingProcessor(_logger);
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_123",
      name: "Test Agent Workflow",
    };
    processor.onTraceStart(mockTrace);

    const mockErrorSpan = {
      type: "trace.span",
      spanId: "span_error_606",
      traceId: "trace_123",
      spanData: {
        type: "function",
        name: "failing_function",
        input: { param: "value" },
      },
      error: "Function execution failed: Invalid parameter",
    };

    processor.onSpanStart(mockErrorSpan);
    processor.onSpanEnd(mockErrorSpan);
    processor.onTraceEnd(mockTrace);
    
    processor.shutdown();
  });

  test("works without logger (uses global)", () => {
    const processor = new BraintrustTracingProcessor();
    
    const mockTrace = {
      type: "trace",
      traceId: "trace_global",
      name: "Global Logger Test",
    };

    // Should not throw
    processor.onTraceStart(mockTrace);
    processor.onTraceEnd(mockTrace);
    processor.shutdown();
  });
});