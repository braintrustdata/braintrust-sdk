import { SpanTypeAttribute } from "../../util/index";
import { startSpan, type CompiledPrompt } from "../logger";
import {
  detectProviderFromResult,
  extractModelFromResult,
  extractModelFromWrapGenerateCallback,
  extractModelParameters,
  normalizeUsageMetrics,
  extractToolCallsFromSteps,
  extractToolCallsFromBlocks,
  buildAssistantOutputWithToolCalls,
  extractInput,
} from "./ai-sdk-shared";
import { processInputAttachments } from "./attachment-utils";

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
  /** Span info from loadPrompt for prompt version tracking */
  spanInfo?: CompiledPrompt<"chat">["span_info"];
}

// V2-specific exclude keys for extractModelParameters
const V2_EXCLUDE_KEYS = new Set([
  "prompt", // Already captured as input
  "system", // Already captured as input
  "messages", // Already captured as input
  "model", // Already captured in metadata.model
  "providerOptions", // Internal AI SDK configuration
]);

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
    wrapGenerate: async ({
      doGenerate,
      params,
      model: modelFromWrapGenerate,
    }) => {
      // Extract and process input attachments
      const rawInput = extractInput(params);
      const processedInput = processInputAttachments(rawInput);

      const spanArgs = {
        name: config.spanInfo?.name || "ai-sdk.doGenerate",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
          ...(config.spanInfo?.spanAttributes || {}),
        },
        event: {
          input: processedInput,
          metadata: {
            ...extractModelParameters(params, V2_EXCLUDE_KEYS),
            ...(config.spanInfo?.metadata || {}),
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
        } else if (modelFromWrapGenerate) {
          // Use the model from the wrapGenerate call if it's not in the result
          const modelId = extractModelFromWrapGenerateCallback(
            modelFromWrapGenerate,
          );
          if (modelId) {
            metadata.model = modelId;
          }
        }

        let toolCalls = extractToolCallsFromSteps((result as any)?.steps);
        if (!toolCalls || toolCalls.length === 0) {
          toolCalls = extractToolCallsFromBlocks((result as any)?.content);
        }

        span.log({
          output:
            toolCalls.length > 0
              ? buildAssistantOutputWithToolCalls(result, toolCalls)
              : (result as any)?.content,
          metadata,
          metrics: normalizeUsageMetrics(
            result.usage,
            provider,
            result.providerMetadata,
          ),
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
      // Extract and process input attachments
      const rawInput = extractInput(params);
      const processedInput = processInputAttachments(rawInput);

      const spanArgs = {
        name: config.spanInfo?.name || "ai-sdk.doStream",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
          ...(config.spanInfo?.spanAttributes || {}),
        },
        event: {
          input: processedInput,
          metadata: {
            ...extractModelParameters(params, V2_EXCLUDE_KEYS),
            ...(config.spanInfo?.metadata || {}),
          },
        },
      };

      const span = startSpan(spanArgs);

      try {
        const { stream, ...rest } = await doStream();

        const textChunks: string[] = [];
        const toolBlocks: any[] = [];
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

              // Collect tool call/result blocks for formatting later
              if (chunk.type === "tool-call" || chunk.type === "tool-result") {
                toolBlocks.push(chunk);
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
              let output: unknown = generatedText
                ? [{ type: "text", text: generatedText }]
                : [];

              // Create a result object for provider detection
              const resultForDetection = {
                providerMetadata,
                response: rest.response,
                ...rest,
                finishReason: finalFinishReason,
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

              // If tool calls streamed, prefer assistant tool_calls output
              if (toolBlocks.length > 0) {
                const toolCalls = extractToolCallsFromSteps([
                  { content: toolBlocks },
                ] as any);
                if (toolCalls.length > 0) {
                  output = buildAssistantOutputWithToolCalls(
                    resultForDetection,
                    toolCalls,
                  );
                }
              }

              span.log({
                output,
                metadata,
                metrics: normalizeUsageMetrics(
                  finalUsage,
                  provider,
                  providerMetadata,
                ),
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
