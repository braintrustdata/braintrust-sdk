import { tracingChannel } from "dc-browser";
import { BasePlugin, isAsyncIterable, patchStreamIfNeeded } from "../core";
import type { StartEvent } from "../core";
import { startSpan, Attachment } from "../../logger";
import type { Span } from "../../logger";
import { SpanTypeAttribute, isObject } from "../../../util/index";
import { getCurrentUnixTimestamp } from "../../util";
import { finalizeAnthropicTokens } from "../../wrappers/anthropic-tokens-util";
import type {
  AnthropicBase64Source,
  AnthropicCreateParams,
  AnthropicInputMessage,
  AnthropicMessage,
  AnthropicStreamEvent,
  AnthropicUsage,
} from "../../vendor-sdk-types/anthropic";

/**
 * Auto-instrumentation plugin for the Anthropic SDK.
 *
 * This plugin subscribes to orchestrion channels for Anthropic SDK methods
 * and creates Braintrust spans to track:
 * - messages.create (streaming and non-streaming)
 * - beta.messages.create (streaming and non-streaming)
 *
 * The plugin handles:
 * - Anthropic-specific token metrics (including cache tokens)
 * - Processing message streams
 * - Converting base64 attachments to Attachment objects
 * - Streaming and non-streaming responses
 */
export class AnthropicPlugin extends BasePlugin {
  protected unsubscribers: Array<() => void> = [];

  protected onEnable(): void {
    this.subscribeToAnthropicChannels();
  }

  protected onDisable(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  private subscribeToAnthropicChannels(): void {
    const anthropicConfig: StreamingChannelConfig = {
      name: "anthropic.messages.create",
      type: SpanTypeAttribute.LLM,
      extractInput: (args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const params = (args[0] || {}) as AnthropicCreateParams;
        const input = coalesceInput(params.messages || [], params.system);
        const metadata = filterFrom(params, ["messages", "system"]);
        return {
          input: processAttachmentsInInput(input),
          metadata: { ...metadata, provider: "anthropic" },
        };
      },
      extractOutput: (result: unknown) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const message = result as AnthropicMessage | undefined;
        return message
          ? { role: message.role, content: message.content }
          : null;
      },
      extractMetrics: (result: unknown, startTime?: number) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const message = result as AnthropicMessage | undefined;
        const metrics = parseMetricsFromUsage(message?.usage);
        if (startTime) {
          metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
        }
        const finalized = finalizeAnthropicTokens(metrics);
        // Filter out undefined values to match Record<string, number> type
        return Object.fromEntries(
          Object.entries(finalized).filter(
            (entry): entry is [string, number] => entry[1] !== undefined,
          ),
        );
      },
      extractMetadata: (result: unknown) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const message = result as AnthropicMessage | undefined;
        const metadata: Record<string, unknown> = {};
        const metas = ["stop_reason", "stop_sequence"] as const;
        for (const m of metas) {
          if (message?.[m] !== undefined) {
            metadata[m] = message[m];
          }
        }
        return metadata;
      },
      aggregateChunks: aggregateAnthropicStreamChunks,
      isStreaming: (args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const params = args[0] as AnthropicCreateParams | undefined;
        return params?.stream === true;
      },
    };

    // Messages API - supports streaming via stream=true parameter
    this.subscribeToStreamingChannel(
      "orchestrion:anthropic:messages.create",
      anthropicConfig,
    );

    // Beta Messages API - supports streaming via stream=true parameter
    this.subscribeToStreamingChannel(
      "orchestrion:anthropic:beta.messages.create",
      {
        ...anthropicConfig,
        name: "anthropic.beta.messages.create",
      },
    );
  }

  /**
   * Subscribe to a channel for async methods that may return streams.
   * Handles both streaming and non-streaming responses based on the stream parameter.
   */
  protected subscribeToStreamingChannel(
    channelName: string,
    config: StreamingChannelConfig,
  ): void {
    const channel = tracingChannel(channelName);

    const spans = new WeakMap<WeakKey, { span: Span; startTime: number }>();

    const handlers = {
      start: (event: StartEvent) => {
        const span = startSpan({
          name: config.name,
          spanAttributes: {
            type: config.type,
          },
        });

        const startTime = getCurrentUnixTimestamp();
        spans.set(event, { span, startTime });

        try {
          const { input, metadata } = config.extractInput(event.arguments);
          span.log({
            input,
            metadata,
          });
        } catch (error) {
          console.error(`Error extracting input for ${channelName}:`, error);
        }
      },

      asyncEnd: (event: Record<string, unknown>) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span, startTime } = spanData;
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const eventArguments = (event.arguments ?? []) as unknown[];
        const eventResult = event.result;

        // Check if this is a streaming request based on parameters
        const isStreaming = config.isStreaming
          ? config.isStreaming(eventArguments)
          : isAsyncIterable(eventResult);

        // Check if result is a stream
        if (isStreaming && isAsyncIterable(eventResult)) {
          // Patch the stream to collect chunks
          patchStreamIfNeeded(eventResult, {
            onComplete: (chunks: unknown[]) => {
              try {
                let output: unknown;
                let metrics: Record<string, number>;
                let metadata: Record<string, unknown> = {};

                if (config.aggregateChunks) {
                  const aggregated = config.aggregateChunks(chunks);
                  output = aggregated.output;
                  metrics = aggregated.metrics;
                  metadata = aggregated.metadata || {};
                } else {
                  output = config.extractOutput(chunks);
                  metrics = config.extractMetrics(chunks, startTime);
                  if (config.extractMetadata) {
                    metadata = config.extractMetadata(chunks);
                  }
                }

                // Add time_to_first_token if not already present
                if (!metrics.time_to_first_token && chunks.length > 0) {
                  metrics.time_to_first_token =
                    getCurrentUnixTimestamp() - startTime;
                }

                span.log({
                  output,
                  metrics,
                  metadata,
                });
              } catch (error) {
                console.error(
                  `Error extracting output for ${channelName}:`,
                  error,
                );
              } finally {
                span.end();
              }
            },
            onError: (error: Error) => {
              span.log({
                error: error.message,
              });
              span.end();
            },
          });

          // Don't delete the span from the map yet - it will be ended by the stream
        } else {
          // Non-streaming response
          try {
            const output = config.extractOutput(eventResult);
            const metrics = config.extractMetrics(eventResult, startTime);
            const metadata = config.extractMetadata
              ? config.extractMetadata(eventResult)
              : {};

            span.log({
              output,
              metrics,
              metadata,
            });
          } catch (error) {
            console.error(`Error extracting output for ${channelName}:`, error);
          } finally {
            span.end();
            spans.delete(event);
          }
        }
      },

      error: (event: Record<string, unknown>) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const eventError = event.error as Error | undefined;

        span.log({
          error: eventError?.message,
        });
        span.end();
        spans.delete(event);
      },
    };

    channel.subscribe(handlers);

    // Store unsubscribe function
    this.unsubscribers.push(() => {
      channel.unsubscribe(handlers);
    });
  }
}

interface StreamingChannelConfig {
  name: string;
  type: string;
  extractInput: (args: unknown[]) => {
    input: unknown;
    metadata: Record<string, unknown>;
  };
  extractOutput: (result: unknown) => unknown;
  extractMetrics: (
    result: unknown,
    startTime?: number,
  ) => Record<string, number>;
  extractMetadata?: (result: unknown) => Record<string, unknown>;
  aggregateChunks?: (chunks: unknown[]) => {
    output: unknown;
    metrics: Record<string, number>;
    metadata?: Record<string, unknown>;
  };
  isStreaming?: (args: unknown[]) => boolean;
}

/**
 * Parse metrics from Anthropic usage object.
 * Maps Anthropic's token names to Braintrust's standard names.
 */
export function parseMetricsFromUsage(
  usage: AnthropicUsage | undefined,
): Record<string, number> {
  if (!usage) {
    return {};
  }

  const metrics: Record<string, number> = {};

  function saveIfExistsTo(source: keyof AnthropicUsage, target: string) {
    const value = usage![source];
    if (value !== undefined && value !== null && typeof value === "number") {
      metrics[target] = value;
    }
  }

  saveIfExistsTo("input_tokens", "prompt_tokens");
  saveIfExistsTo("output_tokens", "completion_tokens");
  saveIfExistsTo("cache_read_input_tokens", "prompt_cached_tokens");
  saveIfExistsTo("cache_creation_input_tokens", "prompt_cache_creation_tokens");

  return metrics;
}

/**
 * Aggregate Anthropic stream chunks into a single response.
 *
 * Anthropic stream format:
 * - message_start: Contains initial message with usage stats
 * - content_block_start: Start of a content block (text, image, etc.)
 * - content_block_delta: Text deltas to concatenate
 * - message_delta: Final usage stats and metadata
 * - message_stop: End of stream
 */
export function aggregateAnthropicStreamChunks(chunks: unknown[]): {
  output: string;
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
} {
  const deltas: string[] = [];
  let metrics: Record<string, number> = {};
  let metadata: Record<string, unknown> = {};

  for (const chunk of chunks) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const event = chunk as AnthropicStreamEvent;
    switch (event?.type) {
      case "message_start":
        // Collect initial metrics from message
        if (event.message?.usage) {
          const initialMetrics = parseMetricsFromUsage(event.message.usage);
          metrics = { ...metrics, ...initialMetrics };
        }
        break;

      case "content_block_delta":
        // Collect text deltas
        if (event.delta?.type === "text_delta") {
          const text = event.delta.text;
          if (text) {
            deltas.push(text);
          }
        }
        break;

      case "message_delta":
        // Collect final usage stats and metadata
        if (event.usage) {
          const finalMetrics = parseMetricsFromUsage(event.usage);
          metrics = { ...metrics, ...finalMetrics };
        }
        if (event.delta) {
          // stop_reason, stop_sequence, etc.
          metadata = { ...metadata, ...event.delta };
        }
        break;
    }
  }

  const output = deltas.join("");

  const finalized = finalizeAnthropicTokens(metrics);
  // Filter out undefined values to match Record<string, number> type
  const filteredMetrics = Object.fromEntries(
    Object.entries(finalized).filter(
      (entry): entry is [string, number] => entry[1] !== undefined,
    ),
  );

  return {
    output,
    metrics: filteredMetrics,
    metadata,
  };
}

/**
 * Helper function to convert base64 content to an Attachment.
 */
function convertBase64ToAttachment(
  source: AnthropicBase64Source,
  contentType: "image" | "document",
): Record<string, unknown> {
  const mediaType =
    typeof source.media_type === "string" ? source.media_type : "image/png";
  const base64Data = source.data;

  if (base64Data && typeof base64Data === "string") {
    // Convert base64 string to Blob
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mediaType });

    // Determine file extension from media type
    const extension = mediaType.split("/")[1] || "bin";
    // Use a descriptive prefix based on content type
    const prefix = contentType === "document" ? "document" : "image";
    const filename = `${prefix}.${extension}`;

    const attachment = new Attachment({
      data: blob,
      filename: filename,
      contentType: mediaType,
    });

    return {
      ...source,
      data: attachment,
    };
  }

  return { ...source };
}

/**
 * Process input to convert base64 attachments (images, PDFs, etc.) to Attachment objects.
 */
export function processAttachmentsInInput(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(processAttachmentsInInput);
  }

  if (isObject(input)) {
    // Check for Anthropic's content blocks with base64 data
    // Supports both "image" and "document" types (for PDFs, etc.)
    if (
      (input.type === "image" || input.type === "document") &&
      isObject(input.source) &&
      input.source.type === "base64"
    ) {
      return {
        ...input,
        source: convertBase64ToAttachment(
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          input.source as unknown as AnthropicBase64Source,
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          input.type as "image" | "document",
        ),
      };
    }

    // Recursively process nested objects
    const processed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      processed[key] = processAttachmentsInInput(value);
    }
    return processed;
  }

  return input;
}

/**
 * Convert Anthropic args to the single "input" field Braintrust expects.
 * Combines messages array with system message if present.
 */
function coalesceInput(
  messages: AnthropicInputMessage[],
  system: AnthropicCreateParams["system"],
): AnthropicInputMessage[] {
  // Make a copy because we're going to mutate it
  const input = (messages || []).slice();
  if (system) {
    input.push({ role: "system", content: system });
  }
  return input;
}

/**
 * Filter out specified fields from an object.
 */
function filterFrom(
  obj: Record<string, unknown>,
  fieldsToRemove: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!fieldsToRemove.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}
