import { SpanTypeAttribute } from "@braintrust/core";
import { startSpan, wrapTraced } from "../logger";
import { getCurrentUnixTimestamp } from "../util";
import {
  detectProviderFromResult,
  extractModelFromResult,
  extractModelParameters,
  normalizeUsageMetrics,
} from "./ai-sdk-shared";

// Import AI SDK v2 types for middleware
import type {
  LanguageModelV2Middleware,
  LanguageModelV2StreamPart,
  LanguageModelV2CallOptions,
  LanguageModelV2Usage,
  SharedV2ProviderMetadata,
} from "@ai-sdk/provider";

// V3-specific exclude keys for extractModelParameters
const V3_EXCLUDE_KEYS = new Set([
  "prompt",
  "system",
  "messages",
  "model",
  "tools",
  "providerOptions",
]);

/**
 * Creates a Braintrust middleware for AI SDK v3 that automatically traces
 * generateText and streamText calls with comprehensive metadata and metrics.
 *
 * @param spanName - The name to use for the span (e.g., "ai-sdk.generateText")
 * @returns A middleware object compatible with AI SDK v2's wrapLanguageModel
 *
 * @example
 * ```typescript
 * import { wrapLanguageModel } from "ai";
 * import { openai } from "@ai-sdk/openai";
 * import { BraintrustAISDKV3Middleware } from "braintrust";
 *
 * const model = wrapLanguageModel({
 *   model: openai("gpt-4"),
 *   middleware: BraintrustAISDKV3Middleware("ai-sdk.generateText")
 * });
 * ```
 */
export function BraintrustAISDKV3Middleware(
  spanName: string = "ai-sdk.generateText",
): LanguageModelV2Middleware {
  return {
    wrapGenerate: async ({ doGenerate, params }) => {
      const span = startSpan({
        name: spanName,
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
      });

      try {
        const result = await doGenerate();

        // Log input, output, metadata, and metrics
        span.log({
          input: extractInput(params),
          output: extractOutput(result, "text"),
          metadata: {
            ...extractModelParameters(params, V3_EXCLUDE_KEYS),
            ...extractResultMetadata(result),
          },
          metrics: normalizeUsageMetrics(
            result.usage,
            detectProviderFromResult(result),
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
      const span = startSpan({
        name: spanName,
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
      });

      const startTime = getCurrentUnixTimestamp();

      // Log initial input and metadata
      span.log({
        input: extractInput(params),
        metadata: extractModelParameters(params, V3_EXCLUDE_KEYS),
      });

      try {
        const result = await doStream();

        let timeToFirstToken: number | undefined = undefined;
        let finalUsage: LanguageModelV2Usage | Record<string, unknown> = {};
        let finalFinishReason: string | undefined = undefined;
        let finalProviderMetadata:
          | SharedV2ProviderMetadata
          | Record<string, unknown> = {};
        let finalObject: unknown = undefined;
        const textChunks: string[] = [];
        const toolCalls: Record<
          string,
          { id: string; name: string; args: string }
        > = {};

        const transformStream = new TransformStream<
          LanguageModelV2StreamPart,
          LanguageModelV2StreamPart
        >({
          transform(chunk, controller) {
            try {
              // Record time to first token on first chunk
              if (timeToFirstToken === undefined) {
                timeToFirstToken = getCurrentUnixTimestamp() - startTime;
                // Always log time_to_first_token, even if it's very small
                span.log({
                  metrics: { time_to_first_token: timeToFirstToken },
                });
              }

              // Handle different chunk types
              switch (chunk.type) {
                case "text-delta": {
                  // Support both textDelta and delta fields
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const anyChunk: any = chunk;
                  const textDelta = anyChunk.textDelta ?? anyChunk.delta ?? "";
                  if (typeof textDelta === "string" && textDelta.length > 0) {
                    textChunks.push(textDelta);
                  }
                  break;
                }

                case "tool-call": {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const anyChunk: any = chunk;
                  if (anyChunk.toolCallId && anyChunk.toolName) {
                    toolCalls[anyChunk.toolCallId] = {
                      id: anyChunk.toolCallId,
                      name: anyChunk.toolName,
                      args:
                        typeof anyChunk.args === "string"
                          ? anyChunk.args
                          : JSON.stringify(anyChunk.args || ""),
                    };
                  }
                  break;
                }

                default: {
                  // Handle tool-call-delta and other chunk types
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const anyChunk: any = chunk;
                  if (
                    anyChunk.type === "tool-call-delta" &&
                    anyChunk.toolCallId &&
                    anyChunk.argsTextDelta
                  ) {
                    if (!toolCalls[anyChunk.toolCallId]) {
                      toolCalls[anyChunk.toolCallId] = {
                        id: anyChunk.toolCallId,
                        name: anyChunk.toolName || "",
                        args: "",
                      };
                    }
                    toolCalls[anyChunk.toolCallId].args +=
                      anyChunk.argsTextDelta;
                  }
                  break;
                }

                case "finish": {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const anyChunk: any = chunk;
                  finalUsage = anyChunk.usage || {};
                  finalFinishReason = anyChunk.finishReason;
                  finalProviderMetadata = anyChunk.providerMetadata || {};
                  if ("object" in anyChunk && anyChunk.object !== undefined) {
                    finalObject = anyChunk.object;
                  }
                  break;
                }
              }

              controller.enqueue(chunk);
            } catch (error) {
              span.log({
                error: error instanceof Error ? error.message : String(error),
              });
              span.end();
              controller.error(error);
            }
          },

          flush() {
            try {
              // Determine output based on span name
              let output: unknown;
              if (spanName.includes("streamObject")) {
                // For object streaming, use the final object from finish chunk
                output = finalObject;
              } else {
                // For text streaming, aggregate text chunks
                const fullText = textChunks.join("");
                output = fullText ? [{ type: "text", text: fullText }] : [];

                // Add tool calls to output if present
                const toolCallsArray = Object.values(toolCalls);
                if (
                  toolCallsArray.length > 0 &&
                  Array.isArray(output) &&
                  output.length > 0
                ) {
                  // Add tool_calls to the first message-like output
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const firstOutput = output[0] as any;
                  if (firstOutput && typeof firstOutput === "object") {
                    if (!firstOutput.message) {
                      firstOutput.message = { role: "assistant" };
                    }
                    firstOutput.message.tool_calls = toolCallsArray.map(
                      (tc) => ({
                        id: tc.id,
                        type: "function" as const,
                        function: {
                          name: tc.name,
                          arguments: tc.args,
                        },
                      }),
                    );
                  }
                }
              }

              // Create result-like object for metadata extraction
              const resultForMetadata = {
                usage: finalUsage,
                providerMetadata: finalProviderMetadata,
                finishReason: finalFinishReason,
                response: result.response,
                request: result.request,
              };

              // Log final output and metadata
              span.log({
                output,
                metadata: {
                  ...extractResultMetadata(resultForMetadata),
                },
                metrics: normalizeUsageMetrics(
                  finalUsage,
                  detectProviderFromResult(resultForMetadata),
                  finalProviderMetadata,
                ),
              });

              span.end();
            } catch (error) {
              span.log({
                error: error instanceof Error ? error.message : String(error),
              });
              span.end();
              throw error;
            }
          },
        });

        return {
          ...result,
          stream: result.stream.pipeThrough(transformStream),
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

function extractInput(params: Record<string, unknown>): unknown {
  if ("prompt" in params && params.prompt) {
    return params.prompt;
  }
  // If no prompt, return messages/system for context
  return {
    messages: "messages" in params ? params.messages : undefined,
    system: "system" in params ? params.system : undefined,
  };
}

function extractOutput(
  result: Record<string, unknown>,
  outputType: "text" | "object",
): unknown {
  if (
    outputType === "object" &&
    "object" in result &&
    result.object !== undefined
  ) {
    return result.object;
  }
  if (outputType === "text" && "text" in result && result.text !== undefined) {
    return result.text;
  }
  // Fallback to any content property
  return (
    ("text" in result ? result.text : undefined) ||
    ("object" in result ? result.object : undefined) ||
    ("content" in result ? result.content : undefined)
  );
}

function extractResultMetadata(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  const provider = detectProviderFromResult(result);
  if (provider !== undefined) {
    metadata.provider = provider;
  }

  const model = extractModelFromResult(result);
  if (model !== undefined) {
    metadata.model = model;
  }

  if ("finishReason" in result && result.finishReason !== undefined) {
    metadata.finish_reason = result.finishReason;
  }

  return metadata;
}
