/* eslint-disable @typescript-eslint/no-explicit-any */

import { startSpan, traced, withCurrent, Attachment } from "../../logger";
import { SpanTypeAttribute } from "../../../util";

// list of json paths to remove from output
const DENY_OUTPUT_PATHS = ["request.body", "response.body"];

/**
 * Wraps Vercel AI SDK methods with Braintrust tracing. Returns wrapped versions
 * of generateText, streamText, generateObject, and streamObject that automatically
 * create spans and log inputs, outputs, and metrics.
 *
 * @param ai - The AI SDK namespace (e.g., import * as ai from "ai")
 * @returns Object with AI SDK methods with Braintrust tracing
 *
 * @example
 * ```typescript
 * import { wrapAISDK } from "braintrust";
 * import * as ai from "ai";
 *
 * const { generateText, streamText, generateObject, streamObject } = wrapAISDK(ai);
 *
 * const result = await generateText({
 *   model: openai("gpt-4"),
 *   prompt: "Hello world"
 * });
 * ```
 */
export function wrapAISDK(aiSDK: any) {
  return new Proxy(aiSDK, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      switch (prop) {
        case "generateText":
          return wrapGenerateText(original);
        case "streamText":
          return wrapStreamText(original);
        case "generateObject":
          return wrapGenerateObject(original);
        case "streamObject":
          return wrapStreamObject(original);
      }
      return original;
    },
  });
}

const wrapGenerateText = (generateText: any) => {
  return async function wrappedGenerateText(params: any) {
    return traced(
      async (span) => {
        const result = await generateText({
          ...params,
          tools: wrapTools(params.tools),
        });

        span.log({
          output: processOutput(result),
          metrics: extractTokenMetrics(result),
        });

        return result;
      },
      {
        name: "ai-sdk.generateText",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: processInputAttachments(params),
          metadata: {
            model: serializeModel(params.model),
            // TODO: provider
          },
        },
      },
    );
  };
};

const wrapGenerateObject = (generateObject: any) => {
  return async function wrappedGenerateObject(params: any) {
    return traced(
      async (span) => {
        const result = await generateObject({
          ...params,
          tools: wrapTools(params.tools),
        });

        span.log({
          output: processOutput(result),
          metrics: extractTokenMetrics(result),
        });

        return result;
      },
      {
        name: "ai-sdk.generateObject",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: processInputAttachments(params),
          metadata: {
            model: params.model,
            // TODO: provider
          },
        },
      },
    );
  };
};

const wrapStreamText = (streamText: any) => {
  return async function wrappedStreamText(params: any) {
    const span = startSpan({
      name: "ai-sdk.streamText",
      event: {
        input: processInputAttachments(params),
        metadata: {
          model: params.model,
          // TODO: provider
        },
      },
    });

    try {
      const startTime = Date.now();
      let receivedFirst = false;
      const result = withCurrent(span, () =>
        streamText({
          ...params,
          tools: wrapTools(params.tools),
          onChunk: (chunk: any) => {
            if (!receivedFirst) {
              receivedFirst = true;
              span.log({
                metrics: {
                  time_to_first_token: (Date.now() - startTime) / 1000,
                },
              });
            }

            params.onChunk?.(chunk);
          },
          onFinish: async (event: any) => {
            params.onFinish?.(event);

            span.log({
              output: processOutput(event),
              metrics: extractTokenMetrics(event),
            });

            span.end();
          },
          onError: async (err: unknown) => {
            params.onError?.(err);

            span.log({
              error: err instanceof Error ? err.message : String(err),
            });

            span.end();
          },
        }),
      );

      return result;
    } catch (error) {
      span.log({
        error: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  };
};

const wrapStreamObject = (streamObject: any) => {
  return async function wrappedStreamObject(params: any) {
    const span = startSpan({
      name: "ai-sdk.streamObject",
      event: {
        input: processInputAttachments(params),
        metadata: {
          model: params.model,
          // TODO: provider
        },
      },
    });

    try {
      const startTime = Date.now();
      let receivedFirst = false;
      const result = withCurrent(span, () =>
        streamObject({
          ...params,
          tools: wrapTools(params.tools),
          onChunk: (chunk: any) => {
            if (!receivedFirst) {
              receivedFirst = true;
              span.log({
                metrics: {
                  time_to_first_token: (Date.now() - startTime) / 1000,
                },
              });
            }

            params.onChunk?.(chunk);
          },
          onFinish: async (event: any) => {
            params.onFinish?.(event);

            span.log({
              output: processOutput(event),
              metrics: extractTokenMetrics(event),
            });

            span.end();
          },
          onError: async (err: unknown) => {
            params.onError?.(err);

            span.log({
              error: err instanceof Error ? err.message : String(err),
            });

            span.end();
          },
        }),
      );
      return result;
    } catch (error) {
      span.log({
        error: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  };
};

const wrapTools = (tools: any) => {
  // if (!tools) return tools;
  // // Helper to infer a useful tool name
  // const inferName = (tool: any, fallback: string) =>
  //   (tool && (tool.name || tool.toolName || tool.id)) || fallback;
  // // Array form: return a shallow-cloned array with wrapped executes
  // if (Array.isArray(tools)) {
  //   const arr = tools;
  //   const out = arr.map((tool, idx) => {
  //     if (
  //       tool != null &&
  //       typeof tool === "object" &&
  //       "execute" in tool &&
  //       typeof tool.execute === "function"
  //     ) {
  //       const name = inferName(tool, `tool[${idx}]`);
  //       return {
  //         ...tool,
  //         execute: wrapTraced((tool as any).execute.bind(tool), {
  //           name,
  //           type: "tool",
  //         }),
  //       };
  //     }
  //     return tool;
  //   });
  //   return out as unknown as TTools;
  // }
  // // Object form: avoid mutating the original tool objects
  // // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // const wrappedTools: Record<string, any> = {};
  // for (const [key, tool] of Object.entries(tools as Record<string, unknown>)) {
  //   if (
  //     tool != null &&
  //     typeof tool === "object" &&
  //     "execute" in tool &&
  //     typeof (tool as any).execute === "function"
  //   ) {
  //     wrappedTools[key] = {
  //       ...(tool as object),
  //       execute: wrapTraced((tool as any).execute.bind(tool), {
  //         name: key,
  //         type: "tool",
  //       }),
  //     };
  //   } else {
  //     wrappedTools[key] = tool;
  //   }
  // }
  // return wrappedTools as unknown as TTools;
  return tools;
};

const serializeModel = (model: any) => {
  return typeof model === "string" ? model : model?.modelId;
};

const processInputAttachments = (input: any) => {
  return input;
};

const processOutput = (output: any) => {
  return omit(processOutputAttachments(output), DENY_OUTPUT_PATHS);
};

const processOutputAttachments = (output: any) => {
  // if (!files || !Array.isArray(files) || files.length === 0) {
  //   return undefined;
  // }
  // return files
  //   .map((file, index) => {
  //     const mediaType = file.mediaType || "application/octet-stream";
  //     const filename = `generated_file_${index}.${getExtensionFromMediaType(mediaType)}`;
  //     // Convert data to Blob using shared utility
  //     const blob = convertDataToBlob(file.data, mediaType);
  //     // Skip if conversion failed (e.g., for URLs we can't fetch)
  //     if (!blob) {
  //       return null;
  //     }
  //     return new Attachment({
  //       data: blob,
  //       filename: filename,
  //       contentType: mediaType,
  //     });
  //   })
  //   .filter((attachment): attachment is Attachment => attachment !== null);
  return output;
};

/**
 * Extracts all token metrics from usage data.
 * Handles various provider formats and naming conventions for token counts.
 */
export function extractTokenMetrics(result: any): Record<string, number> {
  const metrics: Record<string, number> = {};
  const usage = result?.usage;

  if (!usage) {
    return metrics;
  }

  // Prompt tokens
  if (usage.promptTokens !== undefined) {
    metrics.prompt_tokens = usage.promptTokens;
  } else if (usage.prompt_tokens !== undefined) {
    metrics.prompt_tokens = usage.prompt_tokens;
  }

  // Completion tokens
  if (usage.completionTokens !== undefined) {
    metrics.completion_tokens = usage.completionTokens;
  } else if (usage.completion_tokens !== undefined) {
    metrics.completion_tokens = usage.completion_tokens;
  }

  // Total tokens
  if (usage.totalTokens !== undefined) {
    metrics.tokens = usage.totalTokens;
  } else if (usage.tokens !== undefined) {
    metrics.tokens = usage.tokens;
  } else if (usage.total_tokens !== undefined) {
    metrics.tokens = usage.total_tokens;
  }

  // Prompt cached tokens
  if (
    usage.promptCachedTokens !== undefined ||
    usage.prompt_cached_tokens !== undefined
  ) {
    metrics.prompt_cached_tokens =
      usage.promptCachedTokens || usage.prompt_cached_tokens;
  }

  // Prompt cache creation tokens
  if (
    usage.promptCacheCreationTokens !== undefined ||
    usage.prompt_cache_creation_tokens !== undefined
  ) {
    metrics.prompt_cache_creation_tokens =
      usage.promptCacheCreationTokens || usage.prompt_cache_creation_tokens;
  }

  // Prompt reasoning tokens
  if (
    usage.promptReasoningTokens !== undefined ||
    usage.prompt_reasoning_tokens !== undefined
  ) {
    metrics.prompt_reasoning_tokens =
      usage.promptReasoningTokens || usage.prompt_reasoning_tokens;
  }

  // Completion cached tokens
  if (
    usage.completionCachedTokens !== undefined ||
    usage.completion_cached_tokens !== undefined
  ) {
    metrics.completion_cached_tokens =
      usage.completionCachedTokens || usage.completion_cached_tokens;
  }

  // Completion reasoning tokens
  if (
    usage.completionReasoningTokens !== undefined ||
    usage.completion_reasoning_tokens !== undefined ||
    usage.reasoningTokens !== undefined ||
    usage.reasoning_tokens !== undefined ||
    usage.thinkingTokens !== undefined ||
    usage.thinking_tokens !== undefined
  ) {
    const reasoningTokenCount =
      usage.completionReasoningTokens ||
      usage.completion_reasoning_tokens ||
      usage.reasoningTokens ||
      usage.reasoning_tokens ||
      usage.thinkingTokens ||
      usage.thinking_tokens;

    metrics.completion_reasoning_tokens = reasoningTokenCount;
    metrics.reasoning_tokens = reasoningTokenCount;
  }

  // Completion audio tokens
  if (
    usage.completionAudioTokens !== undefined ||
    usage.completion_audio_tokens !== undefined
  ) {
    metrics.completion_audio_tokens =
      usage.completionAudioTokens || usage.completion_audio_tokens;
  }

  return metrics;
}

const omit = (obj: Record<string, unknown>, paths: string[]) => {
  // Create a deep copy of the object
  const result = JSON.parse(JSON.stringify(obj));

  for (const path of paths) {
    const keys = path.split(".");
    let current = result;

    // Navigate to the parent of the property to remove
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        // Path doesn't exist, skip to next path
        break;
      }
    }

    // Remove the final property
    if (current && typeof current === "object" && keys.length > 0) {
      const lastKey = keys[keys.length - 1];
      current[lastKey] = "<omitted>";
    }
  }

  return result;
};
