/* eslint-disable @typescript-eslint/no-explicit-any */
import { SpanTypeAttribute } from "@braintrust/core";
import { Span, startSpan, Experiment, Logger } from "../logger";
import { parseMetricsFromUsage } from "./oai_responses";
import { extractDetailedTokenMetrics } from "./oai";

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
    const data: Record<string, any> = {
      metadata: {
        agent_name: spanData?.name,
        tools_available: spanData?.tools,
        handoffs_available: spanData?.handoffs,
        output_type: spanData?.outputType,
        provider: "openai",
      },
    };

    // Check for input and output at spanData level
    if (spanData?.input !== undefined) {
      data.input = normalizeInputForPrompt(spanData.input);
    }
    if (spanData?.output !== undefined) {
      data.output = spanData.output;
    }

    // Add agent execution timing
    const executionTime = timestampElapsed(span.endedAt, span.startedAt);
    if (executionTime !== undefined) {
      data.metrics = {
        total_execution_time: executionTime,
      };
    }

    return data;
  }

  private extractResponseLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    console.log("=== SPAN DATA AVAILABLE IN EXTRACT ===");
    console.log("spanData keys:", Object.keys(spanData || {}));
    console.log("spanData._response exists:", !!spanData?._response);
    console.log("spanData.response exists:", !!spanData?.response);
    console.log("spanData._input exists:", !!spanData?._input);
    console.log("spanData.input exists:", !!spanData?.input);
    console.log("=== END SPAN DATA DEBUG ===");
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

    // Check for output - regular field first, then underscore fallback
    if (spanData?.output !== undefined) {
      data.output = spanData.output;
    } else if (spanData?._response !== undefined) {
      data.output = spanData._response.output;
    } else if (spanData?.response?.output !== undefined) {
      data.output = spanData.response.output;
    }

    // Initialize metadata and metrics
    data.metadata = {};
    data.metrics = {};

    // Extract timing metrics
    const ttft = timestampElapsed(span.endedAt, span.startedAt);
    if (ttft !== undefined) {
      data.metrics.time_to_first_token = ttft;
    }

    // Extract comprehensive metadata from _response object
    const responseOutput = spanData?._response;
    if (responseOutput) {
      // Model and configuration metadata - separate prompt-replayable params from response metadata
      const promptParams: Record<string, any> = {};
      const responseMetadata: Record<string, any> = {};

      // Parameters needed for prompt replay
      if (responseOutput.model) promptParams.model = responseOutput.model;
      if (responseOutput.temperature !== undefined)
        promptParams.temperature = responseOutput.temperature;
      if (responseOutput.parallel_tool_calls !== undefined)
        promptParams.parallel_tool_calls = responseOutput.parallel_tool_calls;
      if (responseOutput.tool_choice !== undefined)
        promptParams.tool_choice = responseOutput.tool_choice;
      if (responseOutput.top_p !== undefined)
        promptParams.top_p = responseOutput.top_p;
      if (responseOutput.max_output_tokens !== undefined)
        promptParams.max_output_tokens = responseOutput.max_output_tokens;
      if (responseOutput.max_tool_calls !== undefined)
        promptParams.max_tool_calls = responseOutput.max_tool_calls;
      if (responseOutput.truncation !== undefined)
        promptParams.truncation = responseOutput.truncation;
      if (responseOutput.top_logprobs !== undefined)
        promptParams.top_logprobs = responseOutput.top_logprobs;

      // Include tools if tool_choice is specified, transforming to proper OpenAI format
      if (responseOutput.tool_choice && responseOutput.tools) {
        promptParams.tools = responseOutput.tools.map((tool: any) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            ...(tool.strict !== undefined && { strict: tool.strict }),
          },
        }));
      }

      // Response-only metadata (not needed for replay)
      responseMetadata.provider = "openai";
      responseMetadata.response_id = responseOutput.id;
      responseMetadata.service_tier = responseOutput.service_tier;
      responseMetadata.created_at = responseOutput.created_at;
      responseMetadata.status = responseOutput.status;
      responseMetadata.background = responseOutput.background;
      responseMetadata.store = responseOutput.store;
      responseMetadata.previous_response_id =
        responseOutput.previous_response_id;

      // Combine both types of metadata
      data.metadata = {
        ...data.metadata,
        ...promptParams,
        ...responseMetadata,
      };

      // Store detailed tool schemas separately from the tools array used for replay
      if (responseOutput.tools && Array.isArray(responseOutput.tools)) {
        data.metadata.tools_schemas = responseOutput.tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          type: tool.type,
          parameters: tool.parameters,
          strict: tool.strict,
        }));
      }

      // Extract reasoning metadata if available
      if (responseOutput.reasoning) {
        data.metadata.reasoning = responseOutput.reasoning;
      }

      // Extract safety and prompt cache info
      if (responseOutput.safety_identifier) {
        data.metadata.safety_identifier = responseOutput.safety_identifier;
      }
      if (responseOutput.prompt_cache_key) {
        data.metadata.prompt_cache_key = responseOutput.prompt_cache_key;
      }

      // Extract text format info
      if (responseOutput.text?.format) {
        data.metadata.text_format = responseOutput.text.format;
      }

      // Use enhanced token metrics extraction
      if (responseOutput.usage) {
        const detailedMetrics = extractDetailedTokenMetrics(
          responseOutput.usage,
        );
        Object.assign(data.metrics, detailedMetrics);
      }

      // Process tool call outputs with enhanced metadata
      if (responseOutput.output && Array.isArray(responseOutput.output)) {
        data.output = responseOutput.output.map((item: any) => {
          if (item.type === "function_call") {
            return {
              ...item,
              metadata: {
                call_id: item.call_id,
                provider_data: item.providerData,
                arguments_raw: item.arguments,
              },
            };
          }
          return item;
        });
      }

      // Extract additional metadata from response object
      if (responseOutput.metadata) {
        Object.assign(data.metadata, responseOutput.metadata);
      }
    }

    // Fallback to legacy response structure
    if (spanData?.response) {
      const legacyResponse = spanData.response;
      data.metadata = { ...data.metadata, ...(legacyResponse.metadata || {}) };

      // Add other response fields to metadata
      const { output, metadata, usage, ...otherFields } = legacyResponse;
      Object.assign(data.metadata, otherFields);

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
    const data: Record<string, any> = {
      metadata: {
        from_agent: spanData?.fromAgent,
        to_agent: spanData?.toAgent,
        handoff_name: spanData?.name,
        provider: "openai",
      },
    };

    // Add handoff execution timing
    const executionTime = timestampElapsed(span.endedAt, span.startedAt);
    if (executionTime !== undefined) {
      data.metrics = {
        handoff_time: executionTime,
      };
    }

    // Include input/output if available
    if (spanData?.input !== undefined) {
      data.input = normalizeInputForPrompt(spanData.input);
    }
    if (spanData?.output !== undefined) {
      data.output = spanData.output;
    }

    return data;
  }

  private extractGuardrailLogData(span: AgentsSpan): Record<string, any> {
    const spanData = span.spanData;
    const data: Record<string, any> = {
      metadata: {
        guardrail_name: spanData?.name,
        triggered: spanData?.triggered,
        provider: "openai",
      },
    };

    // Add guardrail execution timing
    const executionTime = timestampElapsed(span.endedAt, span.startedAt);
    if (executionTime !== undefined) {
      data.metrics = {
        execution_time: executionTime,
      };
    }

    // Include input/output if available
    if (spanData?.input !== undefined) {
      data.input = normalizeInputForPrompt(spanData.input);
    }
    if (spanData?.output !== undefined) {
      data.output = spanData.output;
    }

    return data;
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
    console.log("=== RAW OPENAI AGENTS DATA (UNFILTERED) ===");
    console.log("span type:", span.spanData?.type);
    if (span.spanData) {
      console.log("All spanData keys:", Object.keys(span.spanData));
      console.log("All spanData entries:");
      console.log("{");
      for (const [key, value] of Object.entries(span.spanData)) {
        console.log(
          `  ${key}:`,
          typeof value === "object" ? JSON.stringify(value, null, 4) : value,
          ",",
        );
      }
      console.log("}");
    }
    console.log("=== END RAW DATA ===");
    console.log("onSpanEnd", span.type, span.spanData?.type);
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
