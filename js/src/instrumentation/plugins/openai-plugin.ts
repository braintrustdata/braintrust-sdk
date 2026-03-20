import type { Span } from "../../logger";
import { Attachment } from "../../logger";
import {
  BRAINTRUST_CACHED_STREAM_METRIC,
  getCachedMetricFromHeaders,
  parseMetricsFromUsage,
} from "../../openai-utils";
import { getCurrentUnixTimestamp } from "../../util";
import { processInputAttachments } from "../../wrappers/attachment-utils";
import { SpanTypeAttribute, isObject } from "../../../util/index";
import { BasePlugin } from "../core";
import {
  traceSyncResultChannel,
  traceSyncStreamChannel,
  unsubscribeAll,
} from "../core/channel-tracing";
import { isAsyncIterable, patchStreamIfNeeded } from "../core/stream-patcher";
import { openAIChannels } from "./openai-channels";
import type {
  OpenAIChatChoice,
  OpenAIChatCompletionChunk,
  OpenAIResponseStreamEvent,
} from "../../vendor-sdk-types/openai";

type OpenAIWithResponseLike<TResult> = {
  data: TResult;
  response: Response;
  [key: string]: unknown;
};

type OpenAIAPIPromiseLike<TResult> = Promise<TResult> & {
  withResponse(): Promise<OpenAIWithResponseLike<TResult>>;
};

type OpenAIPromisePatchConfig<TResult, TChunk = never> = {
  extractOutput: (result: TResult, endEvent?: unknown) => unknown;
  extractMetadata?: (result: TResult, endEvent?: unknown) => unknown;
  extractMetrics: (
    result: TResult,
    startTime?: number,
    endEvent?: unknown,
  ) => Record<string, number>;
  aggregateChunks?: (
    chunks: TChunk[],
    result?: TResult,
    endEvent?: unknown,
    startTime?: number,
  ) => {
    output: unknown;
    metrics: Record<string, number>;
    metadata?: Record<string, unknown>;
  };
};

/**
 * Plugin for OpenAI SDK instrumentation.
 *
 * Handles instrumentation for:
 * - Chat completions
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
    const chatConfig = {
      aggregateChunks: aggregateChatCompletionChunks,
      extractMetrics: (result: any, startTime?: number, endEvent?: unknown) => {
        const metrics = withCachedMetric(
          parseMetricsFromUsage(result?.usage),
          result,
          endEvent,
        );
        if (startTime) {
          metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
        }
        return metrics;
      },
      extractOutput: (result: any) => result?.choices,
    } satisfies OpenAIPromisePatchConfig<any, OpenAIChatCompletionChunk>;

    const responsesConfig = {
      aggregateChunks: aggregateResponseStreamEvents,
      extractMetadata: (result: any) => {
        if (!result) {
          return undefined;
        }
        const { output: _output, usage: _usage, ...metadata } = result;
        return Object.keys(metadata).length > 0 ? metadata : undefined;
      },
      extractMetrics: (result: any, startTime?: number, endEvent?: unknown) => {
        const metrics = withCachedMetric(
          parseMetricsFromUsage(result?.usage),
          result,
          endEvent,
        );
        if (startTime) {
          metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
        }
        return metrics;
      },
      extractOutput: (result: any) => processImagesInOutput(result?.output),
    } satisfies OpenAIPromisePatchConfig<any, OpenAIResponseStreamEvent>;

    this.unsubscribers.push(
      traceSyncResultChannel(openAIChannels.chatCompletionsCreate, {
        name: "Chat Completion",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params]) => {
          const { messages, ...metadata } = params;
          return {
            input: processInputAttachments(messages),
            metadata: { ...metadata, provider: "openai" },
          };
        },
        aggregateChunks: chatConfig.aggregateChunks,
        extractMetrics: chatConfig.extractMetrics,
        extractOutput: chatConfig.extractOutput,
        patchResult: ({ result, span, startTime }) =>
          patchOpenAIAPIPromiseResult({
            config: chatConfig,
            result,
            span,
            startTime,
          }),
      }),
    );

    this.unsubscribers.push(
      traceSyncResultChannel(openAIChannels.embeddingsCreate, {
        name: "Embedding",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params]) => {
          const { input, ...metadata } = params;
          return {
            input,
            metadata: { ...metadata, provider: "openai" },
          };
        },
        extractMetrics: (
          resolvedResult: any,
          _startTime,
          endEvent,
        ): Record<string, number> =>
          withCachedMetric(
            parseMetricsFromUsage(resolvedResult?.usage),
            resolvedResult,
            endEvent,
          ),
        extractOutput: (resolvedResult: any) => {
          const embedding = resolvedResult?.data?.[0]?.embedding;
          return Array.isArray(embedding)
            ? { embedding_length: embedding.length }
            : undefined;
        },
        patchResult: ({ result, span, startTime }) =>
          patchOpenAIAPIPromiseResult({
            config: {
              extractMetrics: (
                resolvedResult: any,
                _startTime,
                endEvent,
              ): Record<string, number> =>
                withCachedMetric(
                  parseMetricsFromUsage(resolvedResult?.usage),
                  resolvedResult,
                  endEvent,
                ),
              extractOutput: (resolvedResult: any) => {
                const embedding = resolvedResult?.data?.[0]?.embedding;
                return Array.isArray(embedding)
                  ? { embedding_length: embedding.length }
                  : undefined;
              },
            },
            result,
            span,
            startTime,
          }),
      }),
    );

    this.unsubscribers.push(
      traceSyncResultChannel(openAIChannels.betaChatCompletionsParse, {
        name: "Chat Completion",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params]) => {
          const { messages, ...metadata } = params;
          return {
            input: processInputAttachments(messages),
            metadata: { ...metadata, provider: "openai" },
          };
        },
        aggregateChunks: chatConfig.aggregateChunks,
        extractMetrics: chatConfig.extractMetrics,
        extractOutput: chatConfig.extractOutput,
        patchResult: ({ result, span, startTime }) =>
          patchOpenAIAPIPromiseResult({
            config: chatConfig,
            result,
            span,
            startTime,
          }),
      }),
    );

    this.unsubscribers.push(
      traceSyncStreamChannel(openAIChannels.betaChatCompletionsStream, {
        name: "Chat Completion",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params]) => {
          const { messages, ...metadata } = params;
          return {
            input: processInputAttachments(messages),
            metadata: { ...metadata, provider: "openai" },
          };
        },
      }),
    );

    this.unsubscribers.push(
      traceSyncResultChannel(openAIChannels.moderationsCreate, {
        name: "Moderation",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params]) => {
          const { input, ...metadata } = params;
          return {
            input,
            metadata: { ...metadata, provider: "openai" },
          };
        },
        extractMetrics: (
          resolvedResult: any,
          _startTime,
          endEvent,
        ): Record<string, number> =>
          withCachedMetric(
            parseMetricsFromUsage(resolvedResult?.usage),
            resolvedResult,
            endEvent,
          ),
        extractOutput: (resolvedResult: any) => resolvedResult?.results,
        patchResult: ({ result, span, startTime }) =>
          patchOpenAIAPIPromiseResult({
            config: {
              extractMetrics: (
                resolvedResult: any,
                _startTime,
                endEvent,
              ): Record<string, number> =>
                withCachedMetric(
                  parseMetricsFromUsage(resolvedResult?.usage),
                  resolvedResult,
                  endEvent,
                ),
              extractOutput: (resolvedResult: any) => resolvedResult?.results,
            },
            result,
            span,
            startTime,
          }),
      }),
    );

    this.unsubscribers.push(
      traceSyncResultChannel(openAIChannels.responsesCreate, {
        name: "openai.responses.create",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params]) => {
          const { input, ...metadata } = params;
          return {
            input: processInputAttachments(input),
            metadata: { ...metadata, provider: "openai" },
          };
        },
        aggregateChunks: responsesConfig.aggregateChunks,
        extractMetadata: responsesConfig.extractMetadata,
        extractMetrics: responsesConfig.extractMetrics,
        extractOutput: responsesConfig.extractOutput,
        patchResult: ({ result, span, startTime }) =>
          patchOpenAIAPIPromiseResult({
            config: responsesConfig,
            result,
            span,
            startTime,
          }),
      }),
    );

    this.unsubscribers.push(
      traceSyncStreamChannel(openAIChannels.responsesStream, {
        name: "openai.responses.create",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params]) => {
          const { input, ...metadata } = params;
          return {
            input: processInputAttachments(input),
            metadata: { ...metadata, provider: "openai" },
          };
        },
        extractFromEvent: (event) => {
          if (event.type !== "response.completed" || !event.response) {
            return {};
          }

          const response = event.response;
          const data: Record<string, unknown> = {};

          if (response.output !== undefined) {
            data.output = processImagesInOutput(response.output);
          }

          const { usage: _usage, output: _output, ...metadata } = response;
          if (Object.keys(metadata).length > 0) {
            data.metadata = metadata;
          }

          data.metrics = parseMetricsFromUsage(response.usage);
          return data;
        },
      }),
    );

    this.unsubscribers.push(
      traceSyncResultChannel(openAIChannels.responsesParse, {
        name: "openai.responses.parse",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params]) => {
          const { input, ...metadata } = params;
          return {
            input: processInputAttachments(input),
            metadata: { ...metadata, provider: "openai" },
          };
        },
        aggregateChunks: responsesConfig.aggregateChunks,
        extractMetadata: responsesConfig.extractMetadata,
        extractMetrics: responsesConfig.extractMetrics,
        extractOutput: responsesConfig.extractOutput,
        patchResult: ({ result, span, startTime }) =>
          patchOpenAIAPIPromiseResult({
            config: responsesConfig,
            result,
            span,
            startTime,
          }),
      }),
    );
  }

  protected onDisable(): void {
    this.unsubscribers = unsubscribeAll(this.unsubscribers);
  }
}

function isOpenAIAPIPromiseLike<TResult>(
  value: unknown,
): value is OpenAIAPIPromiseLike<TResult> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function" &&
    typeof (value as { withResponse?: unknown }).withResponse === "function"
  );
}

export function patchOpenAIAPIPromiseResult<TResult, TChunk = never>(args: {
  config: OpenAIPromisePatchConfig<TResult, TChunk>;
  result: unknown;
  span: Span;
  startTime: number;
}): boolean {
  const { config, result, span, startTime } = args;

  if (
    !isOpenAIAPIPromiseLike<TResult>(result) ||
    !Object.isExtensible(result)
  ) {
    return false;
  }

  const apiPromise = result;
  const originalWithResponse = apiPromise.withResponse.bind(apiPromise);
  let executionPromise: Promise<OpenAIWithResponseLike<TResult>> | null = null;
  let dataPromise: Promise<TResult> | null = null;

  const ensureExecuted = (): Promise<OpenAIWithResponseLike<TResult>> => {
    if (!executionPromise) {
      executionPromise = originalWithResponse()
        .then((enhancedResponse) => {
          const endEvent = { response: enhancedResponse.response };

          if (isAsyncIterable(enhancedResponse.data)) {
            let firstChunkTime: number | undefined;

            patchStreamIfNeeded<TChunk>(enhancedResponse.data, {
              onChunk: () => {
                if (firstChunkTime === undefined) {
                  firstChunkTime = getCurrentUnixTimestamp();
                }
              },
              onComplete: (chunks) => {
                try {
                  if (!config.aggregateChunks) {
                    span.end();
                    return;
                  }

                  const aggregated = config.aggregateChunks(
                    chunks,
                    enhancedResponse.data,
                    endEvent,
                    startTime,
                  );

                  if (
                    aggregated.metrics.time_to_first_token === undefined &&
                    firstChunkTime !== undefined
                  ) {
                    aggregated.metrics.time_to_first_token =
                      firstChunkTime - startTime;
                  } else if (
                    aggregated.metrics.time_to_first_token === undefined &&
                    chunks.length > 0
                  ) {
                    aggregated.metrics.time_to_first_token =
                      getCurrentUnixTimestamp() - startTime;
                  }

                  span.log({
                    output: aggregated.output,
                    ...(aggregated.metadata !== undefined
                      ? { metadata: aggregated.metadata }
                      : {}),
                    metrics: aggregated.metrics,
                  });
                } catch (error) {
                  console.error(
                    "Error extracting OpenAI stream output:",
                    error,
                  );
                } finally {
                  span.end();
                }
              },
              onError: (error) => {
                span.log({
                  error: error.message,
                });
                span.end();
              },
            });

            return enhancedResponse;
          }

          const output = config.extractOutput(enhancedResponse.data, endEvent);
          const metrics = config.extractMetrics(
            enhancedResponse.data,
            startTime,
            endEvent,
          );
          const metadata = config.extractMetadata?.(
            enhancedResponse.data,
            endEvent,
          );
          const normalizedMetadata = isObject(metadata)
            ? (metadata as Record<string, unknown>)
            : undefined;

          span.log({
            output,
            ...(normalizedMetadata !== undefined
              ? { metadata: normalizedMetadata }
              : {}),
            metrics,
          });
          span.end();

          return enhancedResponse;
        })
        .catch((error: unknown) => {
          const resolvedError =
            error instanceof Error ? error : new Error(String(error));
          span.log({
            error: resolvedError.message,
          });
          span.end();
          throw resolvedError;
        });
    }

    return executionPromise;
  };

  const ensureDataPromise = (): Promise<TResult> => {
    if (!dataPromise) {
      dataPromise = ensureExecuted().then(({ data }) => data);
    }

    return dataPromise;
  };

  Object.defineProperties(apiPromise, {
    catch: {
      configurable: true,
      value(onRejected?: (reason: unknown) => unknown) {
        return ensureDataPromise().catch(onRejected);
      },
    },
    finally: {
      configurable: true,
      value(onFinally?: () => void) {
        return ensureDataPromise().finally(onFinally);
      },
    },
    then: {
      configurable: true,
      value(
        onFulfilled?: (value: TResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return ensureDataPromise().then(onFulfilled, onRejected);
      },
    },
    withResponse: {
      configurable: true,
      value() {
        return ensureExecuted();
      },
    },
  });

  return true;
}

function getCachedMetricFromEndEvent(endEvent: unknown): number | undefined {
  if (!isObject(endEvent)) {
    return undefined;
  }

  const response = (endEvent as Record<string, unknown>).response;
  if (!isObject(response)) {
    return undefined;
  }

  const headers = (response as { headers?: unknown }).headers;
  if (!headers || typeof (headers as Headers).get !== "function") {
    return undefined;
  }

  return getCachedMetricFromHeaders(headers as Headers);
}

function withCachedMetric(
  metrics: Record<string, number>,
  result: unknown,
  endEvent?: unknown,
): Record<string, number> {
  if (metrics.cached !== undefined) {
    return metrics;
  }

  const cachedFromEvent = getCachedMetricFromEndEvent(endEvent);
  if (cachedFromEvent !== undefined) {
    return {
      ...metrics,
      cached: cachedFromEvent,
    };
  }

  if (!isObject(result)) {
    return metrics;
  }

  const cached = (result as Record<string, unknown>)[
    BRAINTRUST_CACHED_STREAM_METRIC
  ];

  if (typeof cached !== "number") {
    return metrics;
  }

  return {
    ...metrics,
    cached,
  };
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
export function aggregateChatCompletionChunks(
  chunks: OpenAIChatCompletionChunk[],
  streamResult?: unknown,
  endEvent?: unknown,
): {
  output: OpenAIChatChoice[];
  metrics: Record<string, number>;
} {
  let role = undefined;
  let content = undefined;
  let tool_calls = undefined;
  let finish_reason = undefined;
  let metrics: Record<string, number> = {};

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

  metrics = withCachedMetric(metrics, streamResult, endEvent);

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

function aggregateResponseStreamEvents(
  chunks: OpenAIResponseStreamEvent[],
  _streamResult?: unknown,
  endEvent?: unknown,
): {
  output: any;
  metrics: Record<string, number>;
  metadata?: Record<string, any>;
} {
  let output: any = undefined;
  let metrics: Record<string, number> = {};
  let metadata: Record<string, any> | undefined = undefined;

  for (const chunk of chunks) {
    if (!chunk || !chunk.type || !chunk.response) {
      continue;
    }
    if (chunk.type !== "response.completed") {
      continue;
    }

    const response = chunk.response;
    if (response?.output !== undefined) {
      output = processImagesInOutput(response.output);
    }

    const { usage: _usage, output: _output, ...rest } = response || {};
    if (Object.keys(rest).length > 0) {
      metadata = rest;
    }

    metrics = parseMetricsFromUsage(response?.usage);
  }

  return {
    output,
    metrics: withCachedMetric(metrics, undefined, endEvent),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

export { parseMetricsFromUsage };
