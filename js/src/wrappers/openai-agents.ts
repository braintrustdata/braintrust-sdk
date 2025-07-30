/* eslint-disable @typescript-eslint/no-explicit-any */
import { SpanTypeAttribute } from "@braintrust/core";
import { Span, startSpan, Experiment, Logger } from "../logger";

// TypeScript interfaces for @openai/agents types to avoid direct dependencies
interface AgentsTrace {
  type: string;
  traceId: string;
  name: string;
  groupId?: string;
  metadata?: Record<string, any>;
}

interface AgentsSpan {
  type: string;
  spanId?: string;
  traceId?: string;
  name?: string;
  spanData?: {
    type?: string;
    name?: string;
    tools?: any[];
    handoffs?: any[];
    outputType?: string;
    input?: any;
    output?: any;
    response?: {
      output?: any;
      metadata?: Record<string, any>;
      usage?: {
        totalTokens?: number;
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
      };
    };
    usage?: Record<string, any>;
    model?: string;
    modelConfig?: Record<string, any>;
    fromAgent?: string;
    toAgent?: string;
    triggered?: boolean;
    data?: Record<string, any>;
  };
  startedAt?: string;
  endedAt?: string;
  error?: string;
}

function spanTypeFromAgents(span: AgentsSpan): SpanTypeAttribute {
  const spanType = span.spanData?.type;

  if (spanType === "agent" || spanType === "handoff" || spanType === "custom") {
    return SpanTypeAttribute.TASK;
  } else if (spanType === "function" || spanType === "guardrail") {
    return SpanTypeAttribute.TOOL;
  } else if (spanType === "generation" || spanType === "response") {
    return SpanTypeAttribute.LLM;
  } else {
    return SpanTypeAttribute.TASK;
  }
}

function spanNameFromAgents(span: AgentsSpan): string {
  const spanData = span.spanData;

  if (spanData?.name) {
    return spanData.name;
  }

  switch (spanData?.type) {
    case "generation":
      return "Generation";
    case "response":
      return "Response";
    case "handoff":
      return "Handoff";
    case "agent":
    case "function":
    case "guardrail":
    case "custom":
      return spanData.name || "Unknown";
    default:
      return "Unknown";
  }
}

function timestampElapsed(end?: string, start?: string): number | undefined {
  if (!start || !end) return undefined;
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return (endTime - startTime) / 1000;
}

/**
 * `BraintrustTracingProcessor` is a tracing processor that logs traces from the OpenAI Agents SDK to Braintrust.
 *
 * Args:
 *   logger: A `Span`, `Experiment`, or `Logger` to use for logging.
 *     If `undefined`, the current span, experiment, or logger will be selected exactly as in `startSpan`.
 */
export class BraintrustTracingProcessor {
  private logger?: Span | Experiment | Logger<any>;
  private spans: Map<string, Span> = new Map();

  constructor(logger?: Span | Experiment | Logger<any>) {
    this.logger = logger;
  }

  onTraceStart(trace: AgentsTrace): Promise<void> {
    // Check if we already have a span for this trace to avoid duplicates
    if (this.spans.has(trace.traceId)) {
      return Promise.resolve();
    }

    if (this.logger) {
      const span = this.logger.startSpan({
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
      this.spans.set(trace.traceId, span);
    } else {
      const span = startSpan({
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
      this.spans.set(trace.traceId, span);
    }
    return Promise.resolve();
  }

  onTraceEnd(trace: AgentsTrace): Promise<void> {
    const span = this.spans.get(trace.traceId);
    if (span) {
      span.end();
      this.spans.delete(trace.traceId);
    }
    return Promise.resolve();
  }

  private extractAgentLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    return {
      metadata: {
        tools: spanData?.tools,
        handoffs: spanData?.handoffs,
        outputType: spanData?.outputType,
      },
    };
  }

  private extractResponseLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    const data: Record<string, any> = {};

    if (spanData?.input !== undefined) {
      data.input = spanData.input;
    }

    if (spanData?.response?.output !== undefined) {
      data.output = spanData.response.output;
    }

    if (spanData?.response) {
      data.metadata = spanData.response.metadata || {};
      // Add other response fields to metadata
      const { output, metadata, usage, ...otherFields } = spanData.response;
      Object.assign(data.metadata, otherFields);
    }

    data.metrics = {};
    const ttft = timestampElapsed(span.endedAt, span.startedAt);
    if (ttft !== undefined) {
      data.metrics.time_to_first_token = ttft;
    }

    if (spanData?.response?.usage) {
      const usage = spanData.response.usage;
      if (usage.totalTokens) data.metrics.tokens = usage.totalTokens;
      if (usage.inputTokens) data.metrics.prompt_tokens = usage.inputTokens;
      if (usage.outputTokens)
        data.metrics.completion_tokens = usage.outputTokens;
      // Also check for alternate field names
      if (usage.promptTokens) data.metrics.prompt_tokens = usage.promptTokens;
      if (usage.completionTokens)
        data.metrics.completion_tokens = usage.completionTokens;
    }

    return data;
  }

  private extractFunctionLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    return {
      input: spanData?.input,
      output: spanData?.output,
    };
  }

  private extractHandoffLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    return {
      metadata: {
        fromAgent: spanData?.fromAgent,
        toAgent: spanData?.toAgent,
      },
    };
  }

  private extractGuardrailLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    return {
      metadata: {
        triggered: spanData?.triggered,
      },
    };
  }

  private extractGenerationLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    const metrics: Record<string, any> = {};

    const ttft = timestampElapsed(span.endedAt, span.startedAt);
    if (ttft !== undefined) {
      metrics.time_to_first_token = ttft;
    }

    const usage = spanData?.usage || {};
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
      input: spanData?.input,
      output: spanData?.output,
      metadata: {
        model: spanData?.model,
        modelConfig: spanData?.modelConfig,
      },
      metrics,
    };
  }

  private extractCustomLogData(span: AgentsSpan): Record<string, any> {
    return span.spanData?.data || {};
  }

  private extractLogData(span: AgentsSpan): Record<string, any> {
    const spanType = span.spanData?.type;

    switch (spanType) {
      case "agent":
        return this.extractAgentLogData(span);
      case "response":
        return this.extractResponseLogData(span);
      case "function":
        return this.extractFunctionLogData(span);
      case "handoff":
        return this.extractHandoffLogData(span);
      case "guardrail":
        return this.extractGuardrailLogData(span);
      case "generation":
        return this.extractGenerationLogData(span);
      case "custom":
        return this.extractCustomLogData(span);
      default:
        return {};
    }
  }

  onSpanStart(span: AgentsSpan): Promise<void> {
    if (!span.spanId || !span.traceId) return Promise.resolve();

    // Find parent span - could be another span or the root trace
    let parentSpan: Span | undefined;
    if (span.traceId) {
      parentSpan = this.spans.get(span.traceId);
    }

    if (parentSpan) {
      const childSpan = parentSpan.startSpan({
        name: spanNameFromAgents(span),
        type: spanTypeFromAgents(span),
      });
      this.spans.set(span.spanId, childSpan);
    }
    return Promise.resolve();
  }

  onSpanEnd(span: AgentsSpan): Promise<void> {
    if (!span.spanId) return Promise.resolve();

    const braintrustSpan = this.spans.get(span.spanId);
    if (braintrustSpan) {
      const logData = this.extractLogData(span);
      braintrustSpan.log({
        error: span.error,
        ...logData,
      });
      braintrustSpan.end();
      this.spans.delete(span.spanId);
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
