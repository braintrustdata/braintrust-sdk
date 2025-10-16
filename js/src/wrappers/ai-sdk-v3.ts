import { BraintrustMiddleware } from "./ai-sdk-v2";
import { startSpan, traced, withCurrent, Attachment } from "../logger";
import {
  extractModelParameters,
  detectProviderFromResult,
  wrapTools,
  extractModelFromResult,
  normalizeFinishReason,
  extractInput,
} from "./ai-sdk-shared";

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
]);

/**
 * Converts AI SDK GeneratedFile objects to Braintrust Attachments
 */
function processFilesAsAttachments(
  files: any[] | undefined,
): Attachment[] | undefined {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return undefined;
  }

  return files.map((file, index) => {
    const mediaType = file.mediaType || "application/octet-stream";
    const filename = `generated_file_${index}.${getExtensionFromMediaType(mediaType)}`;

    // Convert data to Blob - handle both base64 string and Uint8Array
    let blob: Blob;
    if (typeof file.data === "string") {
      // Base64 string
      const binaryString = atob(file.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: mediaType });
    } else if (file.data instanceof Uint8Array) {
      // Already binary data
      blob = new Blob([file.data], { type: mediaType });
    } else {
      // Fallback for unexpected data formats
      blob = new Blob([String(file.data)], { type: mediaType });
    }

    return new Attachment({
      data: blob,
      filename: filename,
      contentType: mediaType,
    });
  });
}

/**
 * Get file extension from IANA media type
 */
function getExtensionFromMediaType(mediaType: string): string {
  const extensionMap: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "application/pdf": "pdf",
    "application/json": "json",
    "text/plain": "txt",
    "text/html": "html",
    "text/csv": "csv",
  };

  return extensionMap[mediaType] || "bin";
}

/**
 * Converts data (base64 string, URL, ArrayBuffer, Uint8Array, etc.) to a Blob
 */
function convertDataToBlob(data: any, mediaType: string): Blob | null {
  try {
    if (typeof data === "string") {
      // Could be base64, data URL, or regular URL
      if (data.startsWith("data:")) {
        // Data URL - extract the base64 part
        const base64Match = data.match(/^data:[^;]+;base64,(.+)$/);
        if (base64Match) {
          const base64 = base64Match[1];
          const binaryString = atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          return new Blob([bytes], { type: mediaType });
        }
      } else if (data.startsWith("http://") || data.startsWith("https://")) {
        // URL - we can't fetch it here, so return null to skip
        return null;
      } else {
        // Assume raw base64
        const binaryString = atob(data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return new Blob([bytes], { type: mediaType });
      }
    } else if (data instanceof Uint8Array) {
      return new Blob([data as any], { type: mediaType });
    } else if (data instanceof ArrayBuffer) {
      return new Blob([data as any], { type: mediaType });
    } else if (typeof Buffer !== "undefined" && data instanceof Buffer) {
      return new Blob([data as any], { type: mediaType });
    }
  } catch (error) {
    // If conversion fails, return null
    return null;
  }
  return null;
}

/**
 * Process input to extract and convert image/file content parts to Attachments
 */
function processInputAttachments(input: any): {
  processedInput: any;
  attachments?: Attachment[];
} {
  if (!input) {
    return { processedInput: input };
  }

  const attachments: Attachment[] = [];
  let attachmentIndex = 0;

  // Helper to process a single content part
  const processContentPart = (part: any): any => {
    if (!part || typeof part !== "object") {
      return part;
    }

    // Handle image content parts
    if (part.type === "image" && part.image) {
      const mediaType = "image/png"; // Default, could be inferred
      const blob = convertDataToBlob(part.image, mediaType);

      if (blob) {
        const filename = `input_image_${attachmentIndex}.${getExtensionFromMediaType(mediaType)}`;
        attachmentIndex++;

        const attachment = new Attachment({
          data: blob,
          filename: filename,
          contentType: mediaType,
        });

        attachments.push(attachment);

        // Return a reference instead of the raw data
        return {
          type: "image",
          image: `[Attachment: ${filename}]`,
        };
      }
    }

    // Handle file content parts
    if (part.type === "file" && part.data) {
      const mediaType = part.mediaType || "application/octet-stream";
      const blob = convertDataToBlob(part.data, mediaType);

      if (blob) {
        const filename =
          part.filename ||
          `input_file_${attachmentIndex}.${getExtensionFromMediaType(mediaType)}`;
        attachmentIndex++;

        const attachment = new Attachment({
          data: blob,
          filename: filename,
          contentType: mediaType,
        });

        attachments.push(attachment);

        // Return a reference instead of the raw data
        return {
          type: "file",
          mediaType: mediaType,
          filename: filename,
          data: `[Attachment: ${filename}]`,
        };
      }
    }

    return part;
  };

  // Helper to process a message
  const processMessage = (message: any): any => {
    if (!message || typeof message !== "object") {
      return message;
    }

    // If message has content array, process each part
    if (Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map(processContentPart),
      };
    }

    return message;
  };

  // Process different input types
  if (Array.isArray(input)) {
    // Array of messages
    const processedInput = input.map(processMessage);
    return attachments.length > 0
      ? { processedInput, attachments }
      : { processedInput };
  } else if (typeof input === "object" && input.content) {
    // Single message with content
    const processedInput = processMessage(input);
    return attachments.length > 0
      ? { processedInput, attachments }
      : { processedInput };
  }

  // Simple string or other input - no processing needed
  return { processedInput: input };
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
    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware(),
        });

        const result = await generateText({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
        });

        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(result?.finishReason);

        // Process input attachments
        const rawInput = extractInput(params);
        const { processedInput, attachments: inputAttachments } =
          processInputAttachments(rawInput);
        const input = inputAttachments
          ? { messages: processedInput, attachments: inputAttachments }
          : processedInput;

        // Process generated files as attachments
        const outputAttachments = processFilesAsAttachments(result.files);
        const output = outputAttachments
          ? { text: result.text, files: outputAttachments }
          : result.text;

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
    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware(),
        });
        const result = await generateObject({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
        });

        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(result.finishReason);

        // Process input attachments
        const rawInput = extractInput(params);
        const { processedInput, attachments: inputAttachments } =
          processInputAttachments(rawInput);
        const input = inputAttachments
          ? { messages: processedInput, attachments: inputAttachments }
          : processedInput;

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
    // Process input attachments
    const rawInput = extractInput(params);
    const { processedInput, attachments: inputAttachments } =
      processInputAttachments(rawInput);
    const input = inputAttachments
      ? { messages: processedInput, attachments: inputAttachments }
      : processedInput;

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
        middleware: BraintrustMiddleware(),
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
              ? { text: event?.text, files: outputAttachments }
              : event?.text;

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
    // Process input attachments
    const rawInput = extractInput(params);
    const { processedInput, attachments: inputAttachments } =
      processInputAttachments(rawInput);
    const input = inputAttachments
      ? { messages: processedInput, attachments: inputAttachments }
      : processedInput;

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
        middleware: BraintrustMiddleware(),
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
