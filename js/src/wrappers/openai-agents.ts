/* eslint-disable @typescript-eslint/no-explicit-any */
import { SpanTypeAttribute } from "@braintrust/core";
import { Span, startSpan, Experiment, Logger } from "../logger";
import { extractDetailedTokenMetrics } from "./oai";
import { chatCompletionFromResponse } from "./openai-response-converter";

// Helper function to normalize input for Braintrust prompt format
function normalizeInputForPrompt(input: any): any {
  if (!input) return input;

  // If input is an array, filter and normalize messages
  if (Array.isArray(input)) {
    const messages = input
      .filter((item: any) => {
        // Only include actual chat messages, not function calls or results
        return (
          item.type === "message" ||
          (item.role &&
            [
              "system",
              "user",
              "assistant",
              "tool",
              "function",
              "developer",
            ].includes(item.role))
        );
      })
      .map((item: any) => {
        // Normalize message format
        if (item.type === "message") {
          return {
            role: item.role,
            content: item.content,
          };
        }
        // Already in correct format
        return {
          role: item.role,
          content: item.content,
        };
      });

    return messages.length > 0 ? messages : input;
  }

  return input;
}

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
    // OpenAI agents library underscore fields
    _input?: any;
    _response?: any;
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
  toJSON?: () => Record<string, any>;
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
    const executionTime = timestampElapsed(span.endedAt, span.startedAt);
    
    return {
      input: spanData?.input ? normalizeInputForPrompt(spanData.input) : undefined,
      output: spanData?.output,
      metadata: {
        agent_name: spanData?.name,
        provider: "openai",
      },
      metrics: executionTime ? { total_execution_time: executionTime } : {},
    };
  }

  private extractResponseLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    const data: Record<string, any> = {};

    // Check for input - regular field first, then underscore fallback
    let rawInput;
    if (spanData?.input !== undefined) {
      rawInput = spanData.input;
    } else if (spanData?._input !== undefined) {
      rawInput = spanData._input;
    }

    // Normalize input for Braintrust prompt format
    if (rawInput !== undefined) {
      data.input = normalizeInputForPrompt(rawInput);
    }

    // Initialize metadata and metrics
    data.metadata = { provider: "openai" };
    data.metrics = {};

    // Extract timing metrics
    const ttft = timestampElapsed(span.endedAt, span.startedAt);
    if (ttft !== undefined) {
      data.metrics.time_to_first_token = ttft;
    }

    // Use the proxy converter logic for clean transformation
    const responseOutput = spanData?._response;
    if (responseOutput) {
      try {
        // Convert to ChatCompletion format using proxy logic
        const chatCompletion = chatCompletionFromResponse(responseOutput);
        
        // Extract output from the converted format
        if (chatCompletion.choices?.[0]?.message) {
          data.output = chatCompletion.choices[0].message;
        }

        // Extract usage metrics
        if (chatCompletion.usage) {
          data.metrics = {
            ...data.metrics,
            prompt_tokens: chatCompletion.usage.prompt_tokens,
            completion_tokens: chatCompletion.usage.completion_tokens,
            tokens: chatCompletion.usage.total_tokens,
          };
        }

        // Add basic metadata from response
        data.metadata = {
          ...data.metadata,
          model: chatCompletion.model,
          response_id: chatCompletion.id,
          created_at: chatCompletion.created,
        };
      } catch (error) {
        console.warn("Failed to convert response using proxy logic:", error);
        // Fallback to basic extraction
        data.output = responseOutput.output;
        if (responseOutput.usage) {
          const detailedMetrics = extractDetailedTokenMetrics(
            responseOutput.usage,
          );
          Object.assign(data.metrics, detailedMetrics);
        }
      }
    }

    // Fallback to legacy response structure
    if (spanData?.response && !data.output) {
      const legacyResponse = spanData.response;
      data.output = legacyResponse.output;
      data.metadata = { ...data.metadata, ...(legacyResponse.metadata || {}) };

      if (legacyResponse.usage) {
        const legacyMetrics = extractDetailedTokenMetrics(legacyResponse.usage);
        Object.assign(data.metrics, legacyMetrics);
      }
    }

    return data;
  }

  private extractFunctionLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    const data: Record<string, any> = {
      input: spanData?.input,
      output: spanData?.output,
    };

    // Add function/tool metadata
    if (spanData?.name) {
      data.metadata = {
        tool_name: spanData.name,
        provider: "openai",
      };
    }

    // Parse input if it's a JSON string to extract arguments
    if (typeof spanData?.input === "string") {
      try {
        const parsedInput = JSON.parse(spanData.input);
        data.metadata = {
          ...data.metadata,
          arguments: parsedInput,
        };
      } catch (e) {
        // Input is not JSON, keep as string
      }
    }

    // Add execution timing
    const executionTime = timestampElapsed(span.endedAt, span.startedAt);
    if (executionTime !== undefined) {
      data.metrics = {
        execution_time: executionTime,
      };
    }

    return data;
  }

  private extractHandoffLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    const executionTime = timestampElapsed(span.endedAt, span.startedAt);
    
    return {
      input: spanData?.input ? normalizeInputForPrompt(spanData.input) : undefined,
      output: spanData?.output,
      metadata: {
        from_agent: spanData?.fromAgent,
        to_agent: spanData?.toAgent,
        handoff_name: spanData?.name,
        provider: "openai",
      },
      metrics: executionTime ? { handoff_time: executionTime } : {},
    };
  }

  private extractGuardrailLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    const executionTime = timestampElapsed(span.endedAt, span.startedAt);
    
    return {
      input: spanData?.input ? normalizeInputForPrompt(spanData.input) : undefined,
      output: spanData?.output,
      metadata: {
        guardrail_name: spanData?.name,
        triggered: spanData?.triggered,
        provider: "openai",
      },
      metrics: executionTime ? { execution_time: executionTime } : {},
    };
  }

  private extractGenerationLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    const data: Record<string, any> = {
      input: normalizeInputForPrompt(spanData?.input),
      output: spanData?.output,
      metadata: {
        model: spanData?.model,
        modelConfig: spanData?.modelConfig,
        provider: "openai",
      },
      metrics: {},
    };

    // Extract timing metrics
    const ttft = timestampElapsed(span.endedAt, span.startedAt);
    if (ttft !== undefined) {
      data.metrics.time_to_first_token = ttft;
    }

    // Use enhanced token metrics extraction
    if (spanData?.usage) {
      const detailedMetrics = extractDetailedTokenMetrics(spanData.usage);
      Object.assign(data.metrics, detailedMetrics);
    }

    return data;
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
      // console.log("logData", JSON.stringify(logData, null, 2));
      braintrustSpan.log({
        error: span.error,
        ...logData,
      });
      braintrustSpan.end();
      this.spans.delete(span.spanId);
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
