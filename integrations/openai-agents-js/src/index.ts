/* eslint-disable @typescript-eslint/no-explicit-any */
import { SpanTypeAttribute } from "@braintrust/core";
import { Span as BraintrustSpan, startSpan, Logger } from "braintrust";
import type {
  SpanData,
  AgentSpanData,
  FunctionSpanData,
  GenerationSpanData,
  ResponseSpanData,
  HandoffSpanData,
  CustomSpanData,
  GuardrailSpanData,
} from "@openai/agents-core/dist/tracing/spans";

import type { Trace, Span } from "@openai/agents";

enum SpanType {
  AGENT = "agent",
  RESPONSE = "response",
  FUNCTION = "function",
  HANDOFF = "handoff",
  GUARDRAIL = "guardrail",
  GENERATION = "generation",
  CUSTOM = "custom",
}

type AgentsTrace = Trace;

type AgentsSpan = Span<SpanData>;

type SpanInput =
  | string
  | Array<Record<string, unknown>>
  | Record<string, unknown>[];
type SpanOutput =
  | string
  | Array<Record<string, unknown>>
  | Record<string, unknown>;

function isResponseSpanData(spanData: SpanData): spanData is ResponseSpanData {
  return spanData.type === SpanType.RESPONSE;
}

function isGenerationSpanData(
  spanData: SpanData,
): spanData is GenerationSpanData {
  return spanData.type === SpanType.GENERATION;
}

function isAgentSpanData(spanData: SpanData): spanData is AgentSpanData {
  return spanData.type === SpanType.AGENT;
}

function isFunctionSpanData(spanData: SpanData): spanData is FunctionSpanData {
  return spanData.type === SpanType.FUNCTION;
}

function isHandoffSpanData(spanData: SpanData): spanData is HandoffSpanData {
  return spanData.type === SpanType.HANDOFF;
}

function isGuardrailSpanData(
  spanData: SpanData,
): spanData is GuardrailSpanData {
  return spanData.type === SpanType.GUARDRAIL;
}

function isCustomSpanData(spanData: SpanData): spanData is CustomSpanData {
  return spanData.type === SpanType.CUSTOM;
}

function spanTypeFromAgents(span: AgentsSpan): SpanTypeAttribute {
  const spanType = span.spanData.type;

  if (
    spanType === SpanType.AGENT ||
    spanType === SpanType.HANDOFF ||
    spanType === SpanType.CUSTOM
  ) {
    return SpanTypeAttribute.TASK;
  } else if (
    spanType === SpanType.FUNCTION ||
    spanType === SpanType.GUARDRAIL
  ) {
    return SpanTypeAttribute.TOOL;
  } else if (
    spanType === SpanType.GENERATION ||
    spanType === SpanType.RESPONSE
  ) {
    return SpanTypeAttribute.LLM;
  } else {
    return SpanTypeAttribute.TASK;
  }
}

function spanNameFromAgents(span: AgentsSpan): string {
  const spanData = span.spanData;

  if ("name" in spanData && spanData.name) {
    return spanData.name;
  }

  switch (spanData.type) {
    case SpanType.GENERATION:
      return "Generation";
    case SpanType.RESPONSE:
      return "Response";
    case SpanType.HANDOFF:
      return "Handoff";
    case SpanType.AGENT:
    case SpanType.FUNCTION:
    case SpanType.GUARDRAIL:
    case SpanType.CUSTOM:
      return "name" in spanData && spanData.name ? spanData.name : "Unknown";
    default:
      return "Unknown";
  }
}

function getTimeElapsed(end?: string, start?: string): number | undefined {
  if (!start || !end) return undefined;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return (endTime - startTime) / 1000;
}

/**
 * `OpenAIAgentsTracingProcessor` is a tracing processor that logs traces from the OpenAI Agents SDK to Braintrust.
 *
 * Args:
 *   options: Configuration options including:
 *     - logger: A `Span`, `Experiment`, or `Logger` to use for logging.
 *       If `undefined`, the current span, experiment, or logger will be selected exactly as in `startSpan`.
 *     - maxTraces: Maximum number of concurrent traces to keep in memory (default: 1000).
 *       When exceeded, oldest traces are evicted using LRU policy.
 */
type TraceMetadata = {
  firstInput: SpanInput | null;
  lastOutput: SpanOutput | null;
};

export interface OpenAIAgentsTracingProcessorOptions {
  logger?: Logger<any>;
  maxTraces?: number;
}

export class OpenAIAgentsTracingProcessor {
  private static readonly DEFAULT_MAX_TRACES = 1000;

  private logger?: Logger<any>;
  private maxTraces: number;
  // Flat storage: traceId for root spans, traceId:spanId for child spans
  private spans = new Map<string, BraintrustSpan>();
  private traceMetadata = new Map<string, TraceMetadata>();
  private traceOrder: string[] = []; // Track insertion order for LRU

  // Expose for testing
  public readonly _spans = this.spans;
  public readonly _traceMetadata = this.traceMetadata;
  public get _maxTraces(): number {
    return this.maxTraces;
  }

  constructor(options: OpenAIAgentsTracingProcessorOptions = {}) {
    this.logger = options.logger;
    this.maxTraces =
      options.maxTraces ?? OpenAIAgentsTracingProcessor.DEFAULT_MAX_TRACES;
  }

  private evictOldestTrace(): void {
    if (this.traceOrder.length === 0) return;

    const oldestTraceId = this.traceOrder.shift()!; // Remove from front

    // Simply remove references without force-closing spans
    // Let spans close naturally through normal flow
    this.spans.delete(oldestTraceId);

    // Remove all child spans for this trace - more efficient iteration
    const keysToDelete: string[] = [];
    for (const key of this.spans.keys()) {
      if (key.startsWith(`${oldestTraceId}:`)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.spans.delete(key);
    }

    // Clean up metadata
    this.traceMetadata.delete(oldestTraceId);
  }

  onTraceStart(trace: AgentsTrace): Promise<void> {
    // Implement LRU eviction: if we're at capacity, remove oldest trace
    if (this.traceOrder.length >= this.maxTraces) {
      this.evictOldestTrace();
    }

    const span = this.logger
      ? this.logger.startSpan({
          name: trace.name,
          type: SpanTypeAttribute.TASK,
        })
      : startSpan({
          name: trace.name,
          type: SpanTypeAttribute.TASK,
        });

    // Log basic trace info immediately
    span.log({
      input: "Agent workflow started",
      metadata: {
        ...(trace.metadata || {}),
      },
    });

    // Store root span and metadata
    this.spans.set(trace.traceId, span);
    this.traceMetadata.set(trace.traceId, {
      firstInput: null,
      lastOutput: null,
    });
    this.traceOrder.push(trace.traceId);

    return Promise.resolve();
  }

  onTraceEnd(trace: AgentsTrace): Promise<void> {
    const rootSpan = this.spans.get(trace.traceId);
    const metadata = this.traceMetadata.get(trace.traceId);

    if (rootSpan && metadata) {
      // Log first input and last output to the root trace span
      rootSpan.log({
        input: metadata.firstInput,
        output: metadata.lastOutput,
      });
      rootSpan.end();

      // Simple cleanup - just remove from maps and order
      this.spans.delete(trace.traceId);
      this.traceMetadata.delete(trace.traceId);
      // Remove from order array - find and splice is fine for normal trace end
      const orderIndex = this.traceOrder.indexOf(trace.traceId);
      if (orderIndex > -1) {
        this.traceOrder.splice(orderIndex, 1);
      }
    }
    return Promise.resolve();
  }

  private extractAgentLogData(span: AgentsSpan): Record<string, unknown> {
    const spanData = span.spanData;
    if (!isAgentSpanData(spanData)) {
      return {};
    }

    const data: Record<string, unknown> = {
      metadata: {
        tools: spanData.tools,
        handoffs: spanData.handoffs,
        output_type: spanData.output_type,
      },
    };

    return data;
  }

  private extractResponseLogData(span: AgentsSpan): Record<string, unknown> {
    const spanData = span.spanData;
    const data: Record<string, any> = {};

    // Only proceed if this is actually a response span
    if (!isResponseSpanData(spanData)) {
      return data;
    }

    // Check for input - regular field first, then underscore fallback
    if (spanData._input !== undefined) {
      data.input = spanData._input;
    }

    // Check for output - underscore response first
    if (spanData._response !== undefined) {
      data.output = spanData._response.output;
    }

    if (spanData._response) {
      // Exclude output, metadata, usage, and output_text like Python does
      const { output, metadata, usage, output_text, ...otherFields } =
        spanData._response;
      data.metadata = otherFields;
    }

    data.metrics = {};
    const ttft = getTimeElapsed(
      span.endedAt ?? undefined,
      span.startedAt ?? undefined,
    );
    if (ttft !== undefined) {
      data.metrics.time_to_first_token = ttft;
    }

    // Check for usage in _response
    let usage: any = null;
    if (spanData._response?.usage) {
      usage = spanData._response.usage;
    }

    if (usage) {
      // Check for OpenAI agents SDK field names first
      if (usage.total_tokens) data.metrics.tokens = usage.total_tokens;
      if (usage.input_tokens) data.metrics.prompt_tokens = usage.input_tokens;
      if (usage.output_tokens)
        data.metrics.completion_tokens = usage.output_tokens;

      // Fallback to alternate field names
      if (!data.metrics.tokens && usage.totalTokens)
        data.metrics.tokens = usage.totalTokens;
      if (!data.metrics.prompt_tokens && usage.inputTokens)
        data.metrics.prompt_tokens = usage.inputTokens;
      if (!data.metrics.prompt_tokens && usage.promptTokens)
        data.metrics.prompt_tokens = usage.promptTokens;
      if (!data.metrics.completion_tokens && usage.outputTokens)
        data.metrics.completion_tokens = usage.outputTokens;
      if (!data.metrics.completion_tokens && usage.completionTokens)
        data.metrics.completion_tokens = usage.completionTokens;
    }

    return data;
  }

  private extractFunctionLogData(span: AgentsSpan): Record<string, unknown> {
    const spanData = span.spanData;
    if (!isFunctionSpanData(spanData)) {
      return {};
    }
    return {
      input: spanData.input,
      output: spanData.output,
    };
  }

  private extractHandoffLogData(span: AgentsSpan): Record<string, unknown> {
    const spanData = span.spanData;
    if (!isHandoffSpanData(spanData)) {
      return {};
    }
    return {
      metadata: {
        from_agent: spanData.from_agent,
        to_agent: spanData.to_agent,
      },
    };
  }

  private extractGuardrailLogData(span: AgentsSpan): Record<string, unknown> {
    const spanData = span.spanData;
    if (!isGuardrailSpanData(spanData)) {
      return {};
    }
    return {
      metadata: {
        triggered: spanData.triggered,
      },
    };
  }

  private extractGenerationLogData(span: AgentsSpan): Record<string, unknown> {
    const spanData = span.spanData;
    if (!isGenerationSpanData(spanData)) {
      return {};
    }

    const metrics: Record<string, unknown> = {};

    const ttft = getTimeElapsed(
      span.endedAt ?? undefined,
      span.startedAt ?? undefined,
    );
    if (ttft !== undefined) {
      metrics.time_to_first_token = ttft;
    }

    const usage = spanData.usage || {};
    if (usage.prompt_tokens) metrics.prompt_tokens = usage.prompt_tokens;
    else if (usage.input_tokens) metrics.prompt_tokens = usage.input_tokens;

    if (usage.completion_tokens)
      metrics.completion_tokens = usage.completion_tokens;
    else if (usage.output_tokens)
      metrics.completion_tokens = usage.output_tokens;

    if (usage.total_tokens) metrics.tokens = usage.total_tokens;
    else if (usage.input_tokens && usage.output_tokens) {
      metrics.tokens = usage.input_tokens + usage.output_tokens;
    }

    return {
      input: spanData.input,
      output: spanData.output,
      metadata: {
        model: spanData.model,
        model_config: spanData.model_config,
      },
      metrics,
    };
  }

  private extractCustomLogData(span: AgentsSpan): Record<string, unknown> {
    const spanData = span.spanData;
    if (!isCustomSpanData(spanData)) {
      return {};
    }
    return spanData.data || {};
  }

  private extractLogData(span: AgentsSpan): Record<string, unknown> {
    const spanType = span.spanData?.type;

    switch (spanType) {
      case SpanType.AGENT:
        return this.extractAgentLogData(span);
      case SpanType.RESPONSE:
        return this.extractResponseLogData(span);
      case SpanType.FUNCTION:
        return this.extractFunctionLogData(span);
      case SpanType.HANDOFF:
        return this.extractHandoffLogData(span);
      case SpanType.GUARDRAIL:
        return this.extractGuardrailLogData(span);
      case SpanType.GENERATION:
        return this.extractGenerationLogData(span);
      case SpanType.CUSTOM:
        return this.extractCustomLogData(span);
      default:
        return {};
    }
  }

  onSpanStart(span: AgentsSpan): Promise<void> {
    if (!span.spanId || !span.traceId) return Promise.resolve();

    // Find parent span - use parent_id if available, otherwise fall back to trace root
    let parentSpan: BraintrustSpan | undefined;
    if (span.parentId) {
      parentSpan = this.spans.get(`${span.traceId}:${span.parentId}`);
    } else {
      parentSpan = this.spans.get(span.traceId);
    }

    if (parentSpan) {
      const childSpan = parentSpan.startSpan({
        name: spanNameFromAgents(span),
        type: spanTypeFromAgents(span),
      });
      this.spans.set(`${span.traceId}:${span.spanId}`, childSpan);
    }
    return Promise.resolve();
  }

  onSpanEnd(span: AgentsSpan): Promise<void> {
    if (!span.spanId || !span.traceId) return Promise.resolve();

    const braintrustSpan = this.spans.get(`${span.traceId}:${span.spanId}`);
    const metadata = this.traceMetadata.get(span.traceId);

    if (braintrustSpan && metadata) {
      const logData = this.extractLogData(span);
      braintrustSpan.log({
        error: span.error,
        ...logData,
      });
      braintrustSpan.end();
      this.spans.delete(`${span.traceId}:${span.spanId}`);

      // Track first input and last output for the root trace span
      const input = logData.input as SpanInput;
      const output = logData.output as SpanOutput;

      if (metadata.firstInput === null && input != null) {
        metadata.firstInput = input;
      }

      if (output != null) {
        metadata.lastOutput = output;
      }
    } else {
      console.warn(`No span found for ID: ${span.spanId}`);
    }
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    if (this.logger && typeof this.logger.flush === "function") {
      this.logger.flush();
    }
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    if (this.logger && typeof this.logger.flush === "function") {
      this.logger.flush();
    }
    return Promise.resolve();
  }
}
