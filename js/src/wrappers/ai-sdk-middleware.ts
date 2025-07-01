import {
  LanguageModelV2CallOptions,
  LanguageModelV2Middleware,
} from "@ai-sdk/provider";
import { SpanTypeAttribute } from "@braintrust/core";
import { startSpan } from "../logger";

export interface MiddlewareConfig {
  debug?: boolean;
  name?: string;
}

function detectProviderFromResult(result: any): string | undefined {
  if (!result?.providerMetadata) {
    return undefined;
  }

  const keys = Object.keys(result.providerMetadata); // e.g. "openai", "anthropic"
  return keys.length > 0 ? keys[0] : undefined;
}

function extractModelFromResult(result: any): string | undefined {
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

function extractModelParameters(params: any): Record<string, any> {
  const modelParams: Record<string, any> = {};

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
            ...extractModelParameters(params),
          },
        },
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
