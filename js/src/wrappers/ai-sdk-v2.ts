import { SpanTypeAttribute } from "@braintrust/core";
import { startSpan } from "../logger";

// Minimal interface definitions that are compatible with AI SDK v2
// We use generic types to avoid conflicts with the actual AI SDK types

interface ModelCallOptions {
  prompt?: string;
  system?: string;
  messages?: unknown[];
  model?: string;
  providerOptions?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  [key: string]: unknown;
}

// Generic middleware interface that works with any AI SDK types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface LanguageModelV2Middleware<TModel = any, TCallOptions = any> {
  wrapGenerate?: (options: {
    doGenerate: () => any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
    doStream: () => any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
    params: TCallOptions;
    model: TModel;
  }) => Promise<any> /* eslint-disable-line @typescript-eslint/no-explicit-any */;
  wrapStream?: (options: {
    doGenerate: () => any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
    doStream: () => any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
    params: TCallOptions;
    model: TModel;
  }) => Promise<any> /* eslint-disable-line @typescript-eslint/no-explicit-any */;
}

/**
 * Configuration options for the AI SDK middleware
 */
export interface MiddlewareConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Name identifier for the middleware instance */
  name?: string;
}

function detectProviderFromResult(result: {
  providerMetadata?: Record<string, unknown>;
}): string | undefined {
  if (!result?.providerMetadata) {
    return undefined;
  }

  const keys = Object.keys(result.providerMetadata); // e.g. "openai", "anthropic"
  return keys?.at(0);
}

function extractModelFromResult(result: {
  response?: {
    modelId?: string;
  };
  request?: {
    body?: {
      model?: string;
    };
  };
}): string | undefined {
  // For generateText, model is in response.modelId
  if (result?.response?.modelId) {
    return result.response.modelId;
  }

  // For streaming, model is in request.body.model
  if (result?.request?.body?.model) {
    return result.request.body.model;
  }

  return undefined;
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function extractModelParameters(
  params: ModelCallOptions,
): Record<string, unknown> {
  const modelParams: Record<string, unknown> = {};

  // Parameters to exclude from metadata (already captured elsewhere or not relevant)
  const excludeKeys = new Set([
    "prompt", // Already captured as input
    "system", // Already captured as input
    "messages", // Already captured as input
    "model", // Already captured in metadata.model
    "providerOptions", // Internal AI SDK configuration
  ]);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && !excludeKeys.has(key)) {
      const snakeKey = camelToSnake(key);
      modelParams[snakeKey] = value;
    }
  }

  return modelParams;
}

function getNumberProperty(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) {
    return undefined;
  }
  const value = Reflect.get(obj, key);
  return typeof value === "number" ? value : undefined;
}

function normalizeUsageMetrics(usage: unknown): Record<string, number> {
  const metrics: Record<string, number> = {};

  // AI SDK provides these standard fields
  const inputTokens = getNumberProperty(usage, "inputTokens");
  if (inputTokens !== undefined) {
    metrics.prompt_tokens = inputTokens;
  }

  const outputTokens = getNumberProperty(usage, "outputTokens");
  if (outputTokens !== undefined) {
    metrics.completion_tokens = outputTokens;
  }

  const totalTokens = getNumberProperty(usage, "totalTokens");
  if (totalTokens !== undefined) {
    metrics.tokens = totalTokens;
  }

  // Additional fields that may exist
  const reasoningTokens = getNumberProperty(usage, "reasoningTokens");
  if (reasoningTokens !== undefined) {
    metrics.completion_reasoning_tokens = reasoningTokens;
  }

  const cachedInputTokens = getNumberProperty(usage, "cachedInputTokens");
  if (cachedInputTokens !== undefined) {
    metrics.prompt_cached_tokens = cachedInputTokens;
  }

  return metrics;
}

/**
 * Creates a Braintrust middleware for AI SDK v2 that automatically traces
 * generateText and streamText calls with comprehensive metadata and metrics.
 *
 * @param config - Configuration options for the middleware
 * @returns A middleware object compatible with AI SDK v2's wrapLanguageModel
 *
 * @example
 * ```typescript
 * import { wrapLanguageModel } from "ai";
 * import { openai } from "@ai-sdk/openai";
 * import { BraintrustMiddleware } from "braintrust";
 *
 * const model = wrapLanguageModel({
 *   model: openai("gpt-4"),
 *   middleware: BraintrustMiddleware({ debug: true, name: "MyMiddleware" })
 * });
 * ```
 */
export function BraintrustMiddleware(
  config: MiddlewareConfig = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): LanguageModelV2Middleware<any, any> {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const spanArgs = {
        name: "ai-sdk.generateText",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: params.prompt,
          metadata: {
            ...extractModelParameters(params),
          },
        },
      };

      const span = startSpan(spanArgs);

      try {
        const result = await doGenerate();

        const metadata: Record<string, unknown> = {};

        const provider = detectProviderFromResult(result);
        if (provider !== undefined) {
          metadata.provider = provider;
        }

        if (result.finishReason !== undefined) {
          metadata.finish_reason = result.finishReason;
        }

        const model = extractModelFromResult(result);
        if (model !== undefined) {
          metadata.model = model;
        }

        span.log({
          output: result.content,
          metadata,
          metrics: normalizeUsageMetrics(result.usage),
        });

        return result;
      } catch (error) {
        span.log({
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    },
    wrapStream: async ({ doStream, params }) => {
      const spanArgs = {
        name: "ai-sdk.streamText",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: params.prompt,
          metadata: {
            ...extractModelParameters(params),
          },
        },
      };

      const span = startSpan(spanArgs);

      try {
        const { stream, ...rest } = await doStream();

        const textChunks: string[] = [];
        let finalUsage: unknown = {};
        let finalFinishReason: unknown = undefined;
        let providerMetadata: Record<string, unknown> = {};

        const transformStream = new TransformStream({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transform(chunk: any, controller: any) {
            try {
              // Collect text deltas
              if (chunk.type === "text-delta" && chunk.delta) {
                textChunks.push(chunk.delta);
              }

              // Capture final metadata
              if (chunk.type === "finish") {
                finalFinishReason = chunk.finishReason;
                finalUsage = chunk.usage || {};
                providerMetadata = chunk.providerMetadata || {};
              }

              controller.enqueue(chunk);
            } catch (error) {
              // Log stream processing error
              span.log({
                error: error instanceof Error ? error.message : String(error),
              });
              span.end();
              controller.error(error);
            }
          },

          flush() {
            try {
              // Log the final aggregated result when stream completes
              const generatedText = textChunks.join("");
              const output: unknown = generatedText
                ? [{ type: "text", text: generatedText }]
                : [];

              // Create a result object for provider detection
              const resultForDetection = {
                providerMetadata,
                response: rest.response,
                ...rest,
              };

              const metadata: Record<string, unknown> = {};

              const provider = detectProviderFromResult(resultForDetection);
              if (provider !== undefined) {
                metadata.provider = provider;
              }

              if (finalFinishReason !== undefined) {
                metadata.finish_reason = finalFinishReason;
              }

              const model = extractModelFromResult(resultForDetection);
              if (model !== undefined) {
                metadata.model = model;
              }

              span.log({
                output,
                metadata,
                metrics: normalizeUsageMetrics(finalUsage),
              });

              span.end();
            } catch (error) {
              // Log flush error
              span.log({
                error: error instanceof Error ? error.message : String(error),
              });
              span.end();
              throw error;
            }
          },
        });

        return {
          stream: stream.pipeThrough(transformStream),
          ...rest,
        };
      } catch (error) {
        span.log({
          error: error instanceof Error ? error.message : String(error),
        });
        span.end();
        throw error;
      }
    },
  };
}
