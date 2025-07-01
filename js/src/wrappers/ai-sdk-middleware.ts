import {
  LanguageModelV2CallOptions,
  LanguageModelV2Middleware,
} from "@ai-sdk/provider";
import { SpanTypeAttribute } from "@braintrust/core";
import { startSpan } from "../logger";
import { getCurrentUnixTimestamp } from "../util";

export interface MiddlewareConfig {
  debug?: boolean;
  name?: string;
}

function detectProviderFromParams(params: any): string {
  // Try to detect provider from model parameters
  if (params.providerOptions?.openai) return "openai";
  if (params.providerOptions?.anthropic) return "anthropic";

  // Check if there's any other provider in providerOptions
  if (params.providerOptions) {
    const providerKeys = Object.keys(params.providerOptions);
    if (providerKeys.length > 0) {
      return providerKeys[0];
    }
  }

  // Return unknown - will detect from result instead
  return "unknown";
}

function detectProviderFromResult(result: any): string | undefined {
  if (!result || !result.providerMetadata) {
    return undefined;
  }

  const keys = Object.keys(result.providerMetadata);
  if (keys.length > 0) {
    return keys[0];
  }

  // Fallback to detecting from response headers
  const headers = result.response?.headers || {};
  for (const header of Object.keys(headers)) {
    if (header.startsWith("anthropic-")) {
      return "anthropic";
    }
    if (header.startsWith("openai-")) {
      return "openai";
    }
  }

  return undefined;
}

function extractModelFromResult(result: any): string | undefined {
  // Try to extract model from response metadata (for generateText)
  if (result.response?.modelId) {
    return result.response.modelId;
  }

  // Try to extract from response body for OpenAI responses
  if (result.response?.body?.model) {
    return result.response.body.model;
  }

  // Try to extract from request body (for streaming responses)
  if (result.request?.body?.model) {
    return result.request.body.model;
  }

  return undefined;
}

function normalizeUsageMetrics(usage: any): Record<string, number> {
  if (!usage) {
    return {};
  }

  const metrics: Record<string, number> = {};

  // AI SDK provides these standard fields
  if (typeof usage.inputTokens === "number") {
    metrics.prompt_tokens = usage.inputTokens;
  }
  if (typeof usage.outputTokens === "number") {
    metrics.completion_tokens = usage.outputTokens;
  }
  if (typeof usage.totalTokens === "number") {
    metrics.tokens = usage.totalTokens;
  }

  // Additional fields that may exist
  if (typeof usage.reasoningTokens === "number") {
    metrics.completion_reasoning_tokens = usage.reasoningTokens;
  }
  if (typeof usage.cachedInputTokens === "number") {
    metrics.prompt_cached_tokens = usage.cachedInputTokens;
  }

  return metrics;
}

export function Middleware(
  config: MiddlewareConfig = {},
): LanguageModelV2Middleware {
  const { debug = false, name = "BraintrustMiddleware" } = config;

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
            provider: detectProviderFromParams(params),
            ...params,
            prompt: undefined, // remove prompt from metadata to avoid duplication
          },
        },
        startTime: getCurrentUnixTimestamp(),
      };

      const span = startSpan(spanArgs);

      try {
        const result = await doGenerate();

        const metadata: Record<string, any> = {};

        const provider = detectProviderFromResult(result);
        if (provider !== undefined) {
          metadata.provider = provider;
        }

        if (result.finishReason !== undefined) {
          metadata.finishReason = result.finishReason;
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
            provider: detectProviderFromParams(params),
            ...params,
            prompt: undefined, // remove prompt from metadata to avoid duplication
          },
        },
        startTime: getCurrentUnixTimestamp(),
      };

      const span = startSpan(spanArgs);

      try {
        const { stream, ...rest } = await doStream();

        let generatedText = "";
        let finalUsage: any = {};
        let finalFinishReason: string | undefined = undefined;
        let providerMetadata: any = {};

        const transformStream = new TransformStream({
          transform(chunk: any, controller: any) {
            // Collect text deltas
            if (chunk.type === "text-delta") {
              generatedText += chunk.delta;
            }

            // Capture final metadata
            if (chunk.type === "finish") {
              finalFinishReason = chunk.finishReason;
              finalUsage = chunk.usage || {};
              providerMetadata = chunk.providerMetadata || {};
            }

            controller.enqueue(chunk);
          },

          flush() {
            // Log the final aggregated result when stream completes
            const output = generatedText
              ? [{ type: "text", text: generatedText }]
              : [];

            // Create a result object for provider detection
            const resultForDetection = {
              providerMetadata,
              response: rest.response,
              ...rest,
            };

            const metadata: Record<string, any> = {};

            const provider = detectProviderFromResult(resultForDetection);
            if (provider !== undefined) {
              metadata.provider = provider;
            }

            if (finalFinishReason !== undefined) {
              metadata.finishReason = finalFinishReason;
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
