/* eslint-disable @typescript-eslint/no-explicit-any */
import { SpanTypeAttribute } from "@braintrust/core";
import {
  Span as BraintrustSpan,
  startSpan,
  Experiment,
  Logger,
} from "braintrust";

// TypeScript interfaces for @openai/agents types to avoid direct dependencies
// These match the types from @openai/agents but are defined here to avoid export issues
interface AgentsTrace {
  type: "trace";
  traceId: string;
  name: string;
  groupId: string | null;
  metadata?: Record<string, any>;
}

type SpanDataBase = {
  type: string;
};

type AgentSpanData = SpanDataBase & {
  type: "agent";
  name: string;
  handoffs?: string[];
  tools?: string[];
  output_type?: string;
};

type FunctionSpanData = SpanDataBase & {
  type: "function";
  name: string;
  input: string;
  output: string;
  mcp_data?: string;
};

type GenerationSpanData = SpanDataBase & {
  type: "generation";
  input?: Array<Record<string, any>>;
  output?: Array<Record<string, any>>;
  model?: string;
  model_config?: Record<string, any>;
  usage?: Record<string, any>;
};

type ResponseSpanData = SpanDataBase & {
  type: "response";
  response_id?: string;
  _input?: string | Record<string, any>[];
  _response?: Record<string, any>;
};

type HandoffSpanData = SpanDataBase & {
  type: "handoff";
  from_agent?: string;
  to_agent?: string;
};

type CustomSpanData = SpanDataBase & {
  type: "custom";
  name: string;
  data: Record<string, any>;
};

type GuardrailSpanData = SpanDataBase & {
  type: "guardrail";
  name: string;
  triggered: boolean;
};

type SpanData =
  | AgentSpanData
  | FunctionSpanData
  | GenerationSpanData
  | ResponseSpanData
  | HandoffSpanData
  | CustomSpanData
  | GuardrailSpanData;

type SpanError = {
  message: string;
  data?: Record<string, any>;
};

interface AgentsSpan {
  type: "trace.span";
  traceId: string;
  spanId: string;
  parentId: string | null;
  spanData: SpanData;
  startedAt: string | null;
  endedAt: string | null;
  error: SpanError | null;
}

// Union types for input/output from different span types
type SpanInput = string | Array<Record<string, any>> | Record<string, any>[];
type SpanOutput = string | Array<Record<string, any>> | Record<string, any>;

// Type guard functions
function isResponseSpanData(spanData: SpanData): spanData is ResponseSpanData {
  return spanData.type === "response";
}

function isGenerationSpanData(
  spanData: SpanData,
): spanData is GenerationSpanData {
  return spanData.type === "generation";
}

function isAgentSpanData(spanData: SpanData): spanData is AgentSpanData {
  return spanData.type === "agent";
}

function isFunctionSpanData(spanData: SpanData): spanData is FunctionSpanData {
  return spanData.type === "function";
}

function isHandoffSpanData(spanData: SpanData): spanData is HandoffSpanData {
  return spanData.type === "handoff";
}

function isGuardrailSpanData(
  spanData: SpanData,
): spanData is GuardrailSpanData {
  return spanData.type === "guardrail";
}

function isCustomSpanData(spanData: SpanData): spanData is CustomSpanData {
  return spanData.type === "custom";
}

function spanTypeFromAgents(span: AgentsSpan): SpanTypeAttribute {
  const spanType = span.spanData.type;

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

  if ("name" in spanData && spanData.name) {
    return spanData.name;
  }

  switch (spanData.type) {
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
      return "name" in spanData && spanData.name ? spanData.name : "Unknown";
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
 * `OpenAIAgentsTracingProcessor` is a tracing processor that logs traces from the OpenAI Agents SDK to Braintrust.
 *
 * Args:
 *   logger: A `Span`, `Experiment`, or `Logger` to use for logging.
 *     If `undefined`, the current span, experiment, or logger will be selected exactly as in `startSpan`.
 */
export class OpenAIAgentsTracingProcessor {
  private logger?: Logger<any>;
  private spans: Map<string, BraintrustSpan> = new Map();
  private firstInput: SpanInput | null = null;
  private lastOutput: SpanOutput | null = null;

  constructor(logger?: Logger<any>) {
    this.logger = logger;
  }

  onTraceStart(trace: AgentsTrace): Promise<void> {
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
    this.spans.set(trace.traceId, span);
    return Promise.resolve();
  }

  onTraceEnd(trace: AgentsTrace): Promise<void> {
    const span = this.spans.get(trace.traceId);
    if (span) {
      // Log first input and last output to the root trace span
      span.log({
        input: this.firstInput,
        output: this.lastOutput,
      });
      span.end();
      this.spans.delete(trace.traceId);
    }
    // Reset for next trace
    this.firstInput = null;
    this.lastOutput = null;
    return Promise.resolve();
  }

  private extractAgentLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    if (!isAgentSpanData(spanData)) {
      return {};
    }

    const data: Record<string, any> = {
      metadata: {
        tools: spanData.tools,
        handoffs: spanData.handoffs,
        output_type: spanData.output_type,
      },
    };

    return data;
  }

  private extractResponseLogData(span: AgentsSpan): Record<string, any> {
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
    const ttft = timestampElapsed(
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

  private extractFunctionLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    if (!isFunctionSpanData(spanData)) {
      return {};
    }
    return {
      input: spanData.input,
      output: spanData.output,
    };
  }

  private extractHandoffLogData(span: AgentsSpan): Record<string, any> {
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

  private extractGuardrailLogData(span: AgentsSpan): Record<string, any> {
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

  private extractGenerationLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    if (!isGenerationSpanData(spanData)) {
      return {};
    }

    const metrics: Record<string, any> = {};

    const ttft = timestampElapsed(
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

  private extractCustomLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    if (!isCustomSpanData(spanData)) {
      return {};
    }
    return spanData.data || {};
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

    // Find parent span - use parent_id if available, otherwise fall back to trace root
    let parentSpan: BraintrustSpan | undefined;
    if (span.parentId) {
      parentSpan = this.spans.get(span.parentId);
    } else if (span.traceId) {
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

      // Track first input and last output for the root trace span
      const input = logData.input as SpanInput;
      const output = logData.output as SpanOutput;

      if (this.firstInput === null && input != null) {
        this.firstInput = input;
      }

      if (output != null) {
        this.lastOutput = output;
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
