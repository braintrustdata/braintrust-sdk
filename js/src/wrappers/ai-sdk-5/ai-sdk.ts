import { BraintrustMiddleware } from "./middleware";
import { startSpan, traced, withCurrent, Attachment } from "../../logger";
import type { CompiledPrompt } from "../../logger";
import {
  extractModelParameters,
  detectProviderFromResult,
  wrapTools,
  extractModelFromResult,
  normalizeFinishReason,
  extractInput,
} from "../ai-sdk-shared/utils";
import {
  processInputAttachments,
  getExtensionFromMediaType,
  convertDataToBlob,
} from "../attachment-utils";

// Define a neutral interface for the AI SDK methods we use.
// This avoids importing `typeof import("ai")`, which can cause type-identity
// conflicts when multiple copies/versions of `ai` exist in the workspace.
interface AISDKMethods {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapLanguageModel: (options: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateText: (params: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamText: (params: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateObject: (params: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamObject: (params: any) => any;
}

// V3-specific exclude keys for extractModelParameters
const V3_EXCLUDE_KEYS = new Set([
  "prompt", // Already captured as input
  "system", // Already captured as input
  "messages", // Already captured as input
  "model", // Already captured in metadata.model
  "providerOptions", // Internal AI SDK configuration
  "tools", // Already captured in metadata.tools
  "span_info", // Extracted separately for prompt linking
]);

type SpanInfo = {
  span_info?: CompiledPrompt<"chat">["span_info"];
};

/**
 * Helper function to extract span_info from params.
 * Returns the full span_info to pass through to the middleware.
 */
function extractSpanInfo(params: Record<string, unknown> & SpanInfo): {
  spanInfo?: CompiledPrompt<"chat">["span_info"];
} {
  const { span_info } = params;
  return { spanInfo: span_info };
}

/**
 * Converts AI SDK GeneratedFile objects to Braintrust Attachments
 */
function processFilesAsAttachments(
  files: any[] | undefined,
): Attachment[] | undefined {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return undefined;
  }

  return files
    .map((file, index) => {
      const mediaType = file.mediaType || "application/octet-stream";
      const filename = `generated_file_${index}.${getExtensionFromMediaType(mediaType)}`;

      // Convert data to Blob using shared utility
      const blob = convertDataToBlob(file.data, mediaType);

      // Skip if conversion failed (e.g., for URLs we can't fetch)
      if (!blob) {
        return null;
      }

      return new Attachment({
        data: blob,
        filename: filename,
        contentType: mediaType,
      });
    })
    .filter((attachment): attachment is Attachment => attachment !== null);
}

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
export function wrapAISDK<T extends AISDKMethods>(
  ai: T,
): {
  generateText: T["generateText"];
  streamText: T["streamText"];
  generateObject: T["generateObject"];
  streamObject: T["streamObject"];
} {
  const {
    wrapLanguageModel,
    generateText,
    streamText,
    generateObject,
    streamObject,
  } = ai;
  const wrappedGenerateText = (params: any) => {
    const { spanInfo } = extractSpanInfo(params);

    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware({ spanInfo }),
        });

        const result = await generateText({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
        });

        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(result?.finishReason);

        // Process input attachments for parent span
        const input = processInputAttachments(extractInput(params));

        // Process generated files as attachments
        const outputAttachments = processFilesAsAttachments(result.files);
        const output = outputAttachments
          ? { text: result.text || result.content, files: outputAttachments }
          : result.text || result.content;

        span.log({
          input: input,
          output: output,
          metadata: {
            ...extractModelParameters(params, V3_EXCLUDE_KEYS),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
        });

        return result;
      },
      {
        name: "ai-sdk.generateText",
      },
    );
  };

  const wrappedGenerateObject = (params: any) => {
    const { spanInfo } = extractSpanInfo(params);

    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware({ spanInfo }),
        });
        const result = await generateObject({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
        });

        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(result.finishReason);

        // Process input attachments for parent span
        const input = processInputAttachments(extractInput(params));

        // Process generated files as attachments
        const outputAttachments = processFilesAsAttachments(result.files);
        const output = outputAttachments
          ? { object: result.object, files: outputAttachments }
          : result.object;

        span.log({
          input: input,
          output: output,
          metadata: {
            ...extractModelParameters(params, V3_EXCLUDE_KEYS),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
        });

        return result;
      },
      {
        name: "ai-sdk.generateObject",
      },
    );
  };

  const wrappedStreamText = (params: any) => {
    const { spanInfo } = extractSpanInfo(params);
    // Process input attachments for parent span
    const input = processInputAttachments(extractInput(params));

    const span = startSpan({
      name: "ai-sdk.streamText",
      event: {
        input: input,
        metadata: extractModelParameters(params, V3_EXCLUDE_KEYS),
      },
    });

    const userOnFinish = params.onFinish;
    const userOnError = params.onError;
    const userOnChunk = params.onChunk;

    try {
      const wrappedModel = wrapLanguageModel({
        model: params.model,
        middleware: BraintrustMiddleware({ spanInfo }),
      });

      const startTime = Date.now();
      let receivedFirst = false;
      const result = withCurrent(span, () =>
        streamText({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
          onChunk: (chunk: any) => {
            if (!receivedFirst) {
              receivedFirst = true;
              span.log({
                metrics: {
                  time_to_first_token: (Date.now() - startTime) / 1000,
                },
              });
            }

            if (typeof userOnChunk === "function") {
              userOnChunk(chunk);
            }
          },
          onFinish: async (event: any) => {
            if (typeof userOnFinish === "function") {
              await userOnFinish(event);
            }
            const provider = detectProviderFromResult(event);
            const model = extractModelFromResult(event);
            const finishReason = normalizeFinishReason(event?.finishReason);

            // Process generated files as attachments
            const outputAttachments = processFilesAsAttachments(event.files);
            const output = outputAttachments
              ? {
                  text: event?.text || event?.content,
                  files: outputAttachments,
                }
              : event?.text || event?.content;

            span.log({
              output: output,
              metadata: {
                ...extractModelParameters(params, V3_EXCLUDE_KEYS),
                ...(provider ? { provider } : {}),
                ...(model ? { model } : {}),
                ...(finishReason ? { finish_reason: finishReason } : {}),
              },
            });
            span.end();
          },
          onError: async (err: unknown) => {
            if (typeof userOnError === "function") {
              await userOnError(err);
            }
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

  const wrappedStreamObject = (params: any) => {
    const { spanInfo } = extractSpanInfo(params);
    // Process input attachments for parent span
    const input = processInputAttachments(extractInput(params));

    const span = startSpan({
      name: "ai-sdk.streamObject",
      event: {
        input: input,
        metadata: extractModelParameters(params, V3_EXCLUDE_KEYS),
      },
    });

    const userOnFinish = params.onFinish;
    const userOnError = params.onError;

    try {
      const wrappedModel = wrapLanguageModel({
        model: params.model,
        middleware: BraintrustMiddleware({ spanInfo }),
      });

      const result = withCurrent(span, () =>
        streamObject({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
          onFinish: async (event: any) => {
            if (typeof userOnFinish === "function") {
              await userOnFinish(event);
            }
            const provider = detectProviderFromResult(event);
            const model = extractModelFromResult(event);
            const finishReason = normalizeFinishReason(event?.finishReason);

            // Process generated files as attachments
            const outputAttachments = processFilesAsAttachments(event.files);
            const output = outputAttachments
              ? { object: event?.object, files: outputAttachments }
              : event?.object;

            span.log({
              output: output,
              metadata: {
                ...extractModelParameters(params, V3_EXCLUDE_KEYS),
                ...(provider ? { provider } : {}),
                ...(model ? { model } : {}),
                ...(finishReason ? { finish_reason: finishReason } : {}),
              },
            });
            span.end();
          },
          onError: async (err: unknown) => {
            if (typeof userOnError === "function") {
              await userOnError(err);
            }
            span.log({
              error: err instanceof Error ? err.message : String(err),
            });
            span.end();
          },
        }),
      );

      const startTime = Date.now();
      let receivedFirst = false;

      const trackFirstAccess = () => {
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: {
              time_to_first_token: (Date.now() - startTime) / 1000,
            },
          });
        }
      };

      const [stream1, stream2] = result.baseStream.tee();
      result.baseStream = stream2;

      stream1
        .pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              trackFirstAccess();
              controller.enqueue(chunk);
            },
          }),
        )
        .pipeTo(
          new WritableStream({
            write() {
              // Discard chunks - we only care about the side effect
            },
          }),
        )
        .catch(() => {
          // Silently ignore errors from the tracking stream
        });

      return result;
    } catch (error) {
      span.log({
        error: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  };

  return {
    generateText: wrappedGenerateText as T["generateText"],
    generateObject: wrappedGenerateObject as T["generateObject"],
    streamText: wrappedStreamText as T["streamText"],
    streamObject: wrappedStreamObject as T["streamObject"],
  };
}
