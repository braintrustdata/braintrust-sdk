import { BasePlugin } from "../core";
import { Attachment } from "../../logger";
import { SpanTypeAttribute, isObject } from "../../../util/index";
import { getCurrentUnixTimestamp } from "../../util";
import { processInputAttachments } from "../../wrappers/attachment-utils";

/**
 * Plugin for OpenAI SDK instrumentation.
 *
 * Handles instrumentation for:
 * - Chat completions (streaming and non-streaming)
 * - Embeddings
 * - Moderations
 * - Beta API (parse, stream)
 * - Responses API (create, stream, parse)
 */
export class OpenAIPlugin extends BasePlugin {
  constructor() {
    super();
  }

  protected onEnable(): void {
    // Chat Completions - supports streaming
    this.subscribeToStreamingChannel(
      "orchestrion:openai:chat.completions.create",
      {
        name: "Chat Completion",
        type: SpanTypeAttribute.LLM,
        extractInput: (args: any[]) => {
          const params = args[0] || {};
          const { messages, ...metadata } = params;
          return {
            input: processInputAttachments(messages),
            metadata: { ...metadata, provider: "openai" },
          };
        },
        extractOutput: (result: any) => {
          return result?.choices;
        },
        extractMetrics: (result: any, startTime?: number) => {
          const metrics = parseMetricsFromUsage(result?.usage);
          if (startTime) {
            metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
          }
          return metrics;
        },
        aggregateChunks: aggregateChatCompletionChunks,
      },
    );

    // Embeddings
    this.subscribeToChannel("orchestrion:openai:embeddings.create", {
      name: "Embedding",
      type: SpanTypeAttribute.LLM,
      extractInput: (args: any[]) => {
        const params = args[0] || {};
        const { input, ...metadata } = params;
        return {
          input,
          metadata: { ...metadata, provider: "openai" },
        };
      },
      extractOutput: (result: any) => {
        return result?.data?.map((d: any) => d.embedding);
      },
      extractMetrics: (result: any) => {
        return parseMetricsFromUsage(result?.usage);
      },
    });

    // Beta Chat Completions Parse
    this.subscribeToStreamingChannel(
      "orchestrion:openai:beta.chat.completions.parse",
      {
        name: "Chat Completion",
        type: SpanTypeAttribute.LLM,
        extractInput: (args: any[]) => {
          const params = args[0] || {};
          const { messages, ...metadata } = params;
          return {
            input: processInputAttachments(messages),
            metadata: { ...metadata, provider: "openai" },
          };
        },
        extractOutput: (result: any) => {
          return result?.choices;
        },
        extractMetrics: (result: any, startTime?: number) => {
          const metrics = parseMetricsFromUsage(result?.usage);
          if (startTime) {
            metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
          }
          return metrics;
        },
        aggregateChunks: aggregateChatCompletionChunks,
      },
    );

    // Beta Chat Completions Stream (sync method returning event-based stream)
    this.subscribeToSyncStreamChannel(
      "orchestrion:openai:beta.chat.completions.stream",
      {
        name: "Chat Completion",
        type: SpanTypeAttribute.LLM,
        extractInput: (args: any[]) => {
          const params = args[0] || {};
          const { messages, ...metadata } = params;
          return {
            input: processInputAttachments(messages),
            metadata: { ...metadata, provider: "openai" },
          };
        },
      },
    );

    // Moderations
    this.subscribeToChannel("orchestrion:openai:moderations.create", {
      name: "Moderation",
      type: SpanTypeAttribute.LLM,
      extractInput: (args: any[]) => {
        const params = args[0] || {};
        const { input, ...metadata } = params;
        return {
          input,
          metadata: { ...metadata, provider: "openai" },
        };
      },
      extractOutput: (result: any) => {
        return result?.results;
      },
      extractMetrics: () => {
        // Moderations don't have usage metrics
        return {};
      },
    });

    // Responses API - create (supports streaming via stream=true param)
    this.subscribeToStreamingChannel("orchestrion:openai:responses.create", {
      name: "openai.responses.create",
      type: SpanTypeAttribute.LLM,
      extractInput: (args: any[]) => {
        const params = args[0] || {};
        const { input, ...metadata } = params;
        return {
          input: processInputAttachments(input),
          metadata: { ...metadata, provider: "openai" },
        };
      },
      extractOutput: (result: any) => {
        return processImagesInOutput(result?.output);
      },
      extractMetrics: (result: any, startTime?: number) => {
        const metrics = parseMetricsFromUsage(result?.usage);
        if (startTime) {
          metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
        }
        return metrics;
      },
    });

    // Responses API - stream (sync method returning event-based stream)
    this.subscribeToSyncStreamChannel("orchestrion:openai:responses.stream", {
      name: "openai.responses.stream",
      type: SpanTypeAttribute.LLM,
      extractInput: (args: any[]) => {
        const params = args[0] || {};
        const { input, ...metadata } = params;
        return {
          input: processInputAttachments(input),
          metadata: { ...metadata, provider: "openai" },
        };
      },
      extractFromEvent: (event: any) => {
        if (!event || !event.type || !event.response) {
          return {};
        }

        const response = event.response;

        if (event.type === "response.completed") {
          const data: Record<string, any> = {};

          if (response?.output !== undefined) {
            data.output = processImagesInOutput(response.output);
          }

          // Extract metadata - preserve response fields except usage and output
          if (response) {
            const { usage: _usage, output: _output, ...metadata } = response;
            if (Object.keys(metadata).length > 0) {
              data.metadata = metadata;
            }
          }

          // Extract metrics from usage
          data.metrics = parseMetricsFromUsage(response?.usage);

          return data;
        }

        return {};
      },
    });

    // Responses API - parse
    this.subscribeToStreamingChannel("orchestrion:openai:responses.parse", {
      name: "openai.responses.parse",
      type: SpanTypeAttribute.LLM,
      extractInput: (args: any[]) => {
        const params = args[0] || {};
        const { input, ...metadata } = params;
        return {
          input: processInputAttachments(input),
          metadata: { ...metadata, provider: "openai" },
        };
      },
      extractOutput: (result: any) => {
        return processImagesInOutput(result?.output);
      },
      extractMetrics: (result: any, startTime?: number) => {
        const metrics = parseMetricsFromUsage(result?.usage);
        if (startTime) {
          metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
        }
        return metrics;
      },
    });
  }

  protected onDisable(): void {
    // Unsubscribers are handled by the base class
  }
}

/**
 * Token name mappings for OpenAI metrics.
 */
const TOKEN_NAME_MAP: Record<string, string> = {
  input_tokens: "prompt_tokens",
  output_tokens: "completion_tokens",
  total_tokens: "tokens",
};

/**
 * Token prefix mappings for OpenAI metrics.
 */
const TOKEN_PREFIX_MAP: Record<string, string> = {
  input: "prompt",
  output: "completion",
};

/**
 * Parse metrics from OpenAI usage object.
 * Handles both legacy token names (prompt_tokens, completion_tokens)
 * and newer API token names (input_tokens, output_tokens).
 * Also handles *_tokens_details fields like input_tokens_details.cached_tokens.
 */
export function parseMetricsFromUsage(usage: unknown): Record<string, number> {
  if (!usage) {
    return {};
  }

  const metrics: Record<string, number> = {};

  for (const [oai_name, value] of Object.entries(usage)) {
    if (typeof value === "number") {
      const metricName = TOKEN_NAME_MAP[oai_name] || oai_name;
      metrics[metricName] = value;
    } else if (oai_name.endsWith("_tokens_details")) {
      if (!isObject(value)) {
        continue;
      }
      const rawPrefix = oai_name.slice(0, -"_tokens_details".length);
      const prefix = TOKEN_PREFIX_MAP[rawPrefix] || rawPrefix;
      for (const [key, n] of Object.entries(value)) {
        if (typeof n !== "number") {
          continue;
        }
        const metricName = `${prefix}_${key}`;
        metrics[metricName] = n;
      }
    }
  }

  return metrics;
}

/**
 * Process output to convert base64 images to attachments.
 * Used for Responses API image generation output.
 */
export function processImagesInOutput(output: any): any {
  if (Array.isArray(output)) {
    return output.map(processImagesInOutput);
  }

  if (isObject(output)) {
    if (
      output.type === "image_generation_call" &&
      output.result &&
      typeof output.result === "string"
    ) {
      const fileExtension = output.output_format || "png";
      const contentType = `image/${fileExtension}`;

      const baseFilename =
        output.revised_prompt && typeof output.revised_prompt === "string"
          ? output.revised_prompt.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_")
          : "generated_image";
      const filename = `${baseFilename}.${fileExtension}`;

      // Convert base64 string to Blob
      const binaryString = atob(output.result);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: contentType });

      const attachment = new Attachment({
        data: blob,
        filename: filename,
        contentType: contentType,
      });

      return {
        ...output,
        result: attachment,
      };
    }
  }

  return output;
}

/**
 * Aggregate chat completion chunks into a single response.
 * Combines role (first), content (concatenated), tool_calls (by id),
 * finish_reason (last), and usage (last chunk).
 */
export function aggregateChatCompletionChunks(chunks: any[]): {
  output: any[];
  metrics: Record<string, number>;
} {
  let role = undefined;
  let content = undefined;
  let tool_calls = undefined;
  let finish_reason = undefined;
  let metrics = {};

  for (const chunk of chunks) {
    if (chunk.usage) {
      metrics = {
        ...metrics,
        ...parseMetricsFromUsage(chunk.usage),
      };
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      continue;
    }

    if (!role && delta.role) {
      role = delta.role;
    }

    if (delta.finish_reason) {
      finish_reason = delta.finish_reason;
    }

    if (delta.content) {
      content = (content || "") + delta.content;
    }

    if (delta.tool_calls) {
      const toolDelta = delta.tool_calls[0];
      if (
        !tool_calls ||
        (toolDelta.id && tool_calls[tool_calls.length - 1].id !== toolDelta.id)
      ) {
        tool_calls = [
          ...(tool_calls || []),
          {
            id: toolDelta.id,
            type: toolDelta.type,
            function: toolDelta.function,
          },
        ];
      } else {
        tool_calls[tool_calls.length - 1].function.arguments +=
          toolDelta.function.arguments;
      }
    }
  }

  return {
    metrics,
    output: [
      {
        index: 0,
        message: {
          role,
          content,
          tool_calls,
        },
        logprobs: null,
        finish_reason,
      },
    ],
  };
}
