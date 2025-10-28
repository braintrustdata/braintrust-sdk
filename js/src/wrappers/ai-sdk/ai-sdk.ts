/* eslint-disable @typescript-eslint/no-explicit-any */

import { startSpan, traced, withCurrent, Attachment } from "../../logger";
import { SpanTypeAttribute } from "../../../util";
import {
  convertDataToBlob,
  getExtensionFromMediaType,
} from "../attachment-utils";

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
          output: await processOutput(result),
          metrics: extractTokenMetrics(result),
        });

        return result;
      },
      {
        name: "generateText",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: processInputAttachments(params),
          metadata: {
            model: serializeModel(params.model),
            braintrust: {
              integration_name: "ai-sdk",
              sdk_language: "typescript",
            },
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
        name: "generateObject",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: processInputAttachments(params),
          metadata: {
            model: serializeModel(params.model),
            braintrust: {
              integration_name: "ai-sdk",
              sdk_language: "typescript",
            },
          },
        },
      },
    );
  };
};

const wrapStreamText = (streamText: any) => {
  return async function wrappedStreamText(params: any) {
    const span = startSpan({
      name: "streamText",
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
      },
      event: {
        input: processInputAttachments(params),
        metadata: {
          model: serializeModel(params.model),
          braintrust: {
            integration_name: "ai-sdk",
            sdk_language: "typescript",
          },
        },
      },
    });

    try {
      const startTime = Date.now();
      let receivedFirst = false;
      const result = await withCurrent(span, () =>
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
              output: await processOutput(event),
              metrics: extractTokenMetrics(event),
            });

            span.end();
          },
          onError: async (err: unknown) => {
            params.onError?.(err);

            span.log({
              error: serializeError(err),
            });

            span.end();
          },
        }),
      );

      // Use stream tee to track first token regardless of consumption method
      const trackFirstToken = () => {
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: {
              time_to_first_token: (Date.now() - startTime) / 1000,
            },
          });
        }
      };

      if (result && result.baseStream) {
        const [stream1, stream2] = result.baseStream.tee();
        result.baseStream = stream2;

        stream1
          .pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                trackFirstToken();
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
      }

      return result;
    } catch (error) {
      span.log({
        error: serializeError(error),
      });
      span.end();
      throw error;
    }
  };
};

const wrapStreamObject = (streamObject: any) => {
  return async function wrappedStreamObject(params: any) {
    const span = startSpan({
      name: "streamObject",
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
      },
      event: {
        input: processInputAttachments(params),
        metadata: {
          model: serializeModel(params.model),
          braintrust: {
            integration_name: "ai-sdk",
            sdk_language: "typescript",
          },
        },
      },
    });

    try {
      const startTime = Date.now();
      let receivedFirst = false;

      const result = await withCurrent(span, () =>
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
              output: await processOutput(event),
              metrics: extractTokenMetrics(event),
            });

            span.end();
          },
          onError: async (err: unknown) => {
            params.onError?.(err);

            span.log({
              error: serializeError(err),
            });

            span.end();
          },
        }),
      );

      // Use stream tee to track first token regardless of consumption method
      const trackFirstToken = () => {
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: {
              time_to_first_token: (Date.now() - startTime) / 1000,
            },
          });
        }
      };

      if (result && result.baseStream) {
        const [stream1, stream2] = result.baseStream.tee();
        result.baseStream = stream2;

        stream1
          .pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                trackFirstToken();
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
      }

      return result;
    } catch (error) {
      span.log({
        error: serializeError(error),
      });
      span.end();
      throw error;
    }
  };
};

const wrapTools = (tools: any) => {
  if (!tools) return tools;

  const inferName = (tool: any, fallback: string) =>
    (tool && (tool.name || tool.toolName || tool.id)) || fallback;

  if (Array.isArray(tools)) {
    return tools.map((tool, idx) => {
      const name = inferName(tool, `tool[${idx}]`);
      return wrapToolExecute(tool, name);
    });
  }

  const wrappedTools: Record<string, any> = {};
  for (const [key, tool] of Object.entries(tools)) {
    wrappedTools[key] = wrapToolExecute(tool, key);
  }
  return wrappedTools;
};

const wrapToolExecute = (tool: any, name: string) => {
  if (
    tool != null &&
    typeof tool === "object" &&
    "execute" in tool &&
    typeof tool.execute === "function"
  ) {
    return {
      ...tool,
      execute: (...args: any[]) =>
        traced(() => tool.execute(...args), {
          name: `tool.${name}`,
          spanAttributes: {
            type: SpanTypeAttribute.TOOL,
          },
        }),
    };
  }
  return tool;
};

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {}
  }

  return String(error);
};

const serializeModel = (model: any) => {
  return typeof model === "string" ? model : model?.modelId;
};

const processInputAttachments = (input: any) => {
  if (!input) return input;

  // Process messages array if present
  if (input.messages && Array.isArray(input.messages)) {
    return {
      ...input,
      messages: input.messages.map(processMessage),
    };
  }

  // Process prompt if it's an object with potential attachments
  if (
    input.prompt &&
    typeof input.prompt === "object" &&
    !Array.isArray(input.prompt)
  ) {
    return {
      ...input,
      prompt: processPromptContent(input.prompt),
    };
  }

  return input;
};

const processMessage = (message: any): any => {
  if (!message || typeof message !== "object") return message;

  // If content is an array, process each content part
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: message.content.map(processContentPart),
    };
  }

  // If content is an object (single content part), process it
  if (typeof message.content === "object" && message.content !== null) {
    return {
      ...message,
      content: processContentPart(message.content),
    };
  }

  return message;
};

const processPromptContent = (prompt: any): any => {
  // Handle prompt objects that might contain content arrays
  if (Array.isArray(prompt)) {
    return prompt.map(processContentPart);
  }

  if (prompt.content) {
    if (Array.isArray(prompt.content)) {
      return {
        ...prompt,
        content: prompt.content.map(processContentPart),
      };
    } else if (typeof prompt.content === "object") {
      return {
        ...prompt,
        content: processContentPart(prompt.content),
      };
    }
  }

  return prompt;
};

const processContentPart = (part: any): any => {
  if (!part || typeof part !== "object") return part;

  try {
    // Process image content with data URLs (these have explicit mime types)
    if (part.type === "image" && part.image) {
      const imageAttachment = convertImageToAttachment(
        part.image,
        part.mimeType || part.mediaType,
      );
      if (imageAttachment) {
        return {
          ...part,
          image: imageAttachment,
        };
      }
    }

    // Process file content with explicit mime type
    if (
      part.type === "file" &&
      part.data &&
      (part.mimeType || part.mediaType)
    ) {
      const fileAttachment = convertDataToAttachment(
        part.data,
        part.mimeType || part.mediaType,
        part.name || part.filename,
      );
      if (fileAttachment) {
        return {
          ...part,
          data: fileAttachment,
        };
      }
    }

    // Process image_url format (OpenAI style)
    if (part.type === "image_url" && part.image_url) {
      if (typeof part.image_url === "object" && part.image_url.url) {
        const imageAttachment = convertImageToAttachment(part.image_url.url);
        if (imageAttachment) {
          return {
            ...part,
            image_url: {
              ...part.image_url,
              url: imageAttachment,
            },
          };
        }
      }
    }
  } catch (error) {
    console.warn("Error processing content part:", error);
  }

  return part;
};

const convertImageToAttachment = (
  image: any,
  explicitMimeType?: string,
): Attachment | null => {
  try {
    // Handle data URLs (they contain their own mime type)
    if (typeof image === "string" && image.startsWith("data:")) {
      const [mimeTypeSection, base64Data] = image.split(",");
      const mimeType = mimeTypeSection.match(/data:(.*?);/)?.[1];
      if (mimeType && base64Data) {
        const blob = convertDataToBlob(base64Data, mimeType);
        if (blob) {
          return new Attachment({
            data: blob,
            filename: `image.${getExtensionFromMediaType(mimeType)}`,
            contentType: mimeType,
          });
        }
      }
    }

    // Only convert binary data if we have an explicit mime type
    if (explicitMimeType) {
      // Handle Uint8Array
      if (image instanceof Uint8Array) {
        return new Attachment({
          data: new Blob([image], { type: explicitMimeType }),
          filename: `image.${getExtensionFromMediaType(explicitMimeType)}`,
          contentType: explicitMimeType,
        });
      }

      // Handle Buffer (Node.js)
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(image)) {
        return new Attachment({
          data: new Blob([image], { type: explicitMimeType }),
          filename: `image.${getExtensionFromMediaType(explicitMimeType)}`,
          contentType: explicitMimeType,
        });
      }
    }

    // Handle Blob (has its own type)
    if (image instanceof Blob && image.type) {
      return new Attachment({
        data: image,
        filename: `image.${getExtensionFromMediaType(image.type)}`,
        contentType: image.type,
      });
    }

    // If already an Attachment, return as-is
    if (image instanceof Attachment) {
      return image;
    }
  } catch (error) {
    console.warn("Error converting image to attachment:", error);
  }

  return null;
};

const convertDataToAttachment = (
  data: any,
  mimeType: string,
  filename?: string,
): Attachment | null => {
  if (!mimeType) return null; // Don't convert without explicit mime type

  try {
    let blob: Blob | null = null;

    // Handle data URLs
    if (typeof data === "string" && data.startsWith("data:")) {
      const [, base64Data] = data.split(",");
      if (base64Data) {
        blob = convertDataToBlob(base64Data, mimeType);
      }
    }
    // Handle Uint8Array
    else if (data instanceof Uint8Array) {
      blob = new Blob([data], { type: mimeType });
    }
    // Handle Buffer (Node.js)
    else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
      blob = new Blob([data], { type: mimeType });
    }
    // Handle Blob
    else if (data instanceof Blob) {
      blob = data;
    }

    if (blob) {
      return new Attachment({
        data: blob,
        filename: filename || `file.${getExtensionFromMediaType(mimeType)}`,
        contentType: mimeType,
      });
    }
  } catch (error) {
    console.warn("Error converting data to attachment:", error);
  }

  return null;
};

const extractGetterValues = (obj: any): any => {
  // Extract common getter values from AI SDK result objects
  // These are typically on the prototype and not enumerable
  const getterValues: Record<string, any> = {};

  // List of known getters from AI SDK result objects
  const getterNames = [
    "text",
    "finishReason",
    "usage",
    "toolCalls",
    "toolResults",
    "warnings",
    "experimental_providerMetadata",
    "rawResponse",
    "response",
  ];

  for (const name of getterNames) {
    try {
      if (obj && name in obj && typeof obj[name] !== "function") {
        getterValues[name] = obj[name];
      }
    } catch {
      // Ignore errors accessing getters
    }
  }

  return getterValues;
};

const processOutput = async (output: any) => {
  // Extract getter values before processing
  const getterValues = extractGetterValues(output);

  // Process attachments
  const processed = await processOutputAttachments(output);

  // Merge getter values into the processed output
  const merged = { ...processed, ...getterValues };

  // Apply omit to the merged result to ensure paths are omitted
  return omit(merged, DENY_OUTPUT_PATHS);
};

const processOutputAttachments = async (output: any) => {
  try {
    return await doProcessOutputAttachments(output);
  } catch (error) {
    console.error("Error processing output attachments:", error);
    return output;
  }
};

const doProcessOutputAttachments = async (output: any) => {
  if (!output || !("files" in output)) {
    return output;
  }

  if (output.files && typeof output.files.then === "function") {
    return {
      ...output,
      files: output.files.then(async (files: any[]) => {
        if (!files || !Array.isArray(files) || files.length === 0) {
          return files;
        }
        return files.map(convertFileToAttachment);
      }),
    };
  } else if (
    output.files &&
    Array.isArray(output.files) &&
    output.files.length > 0
  ) {
    return {
      ...output,
      files: output.files.map(convertFileToAttachment),
    };
  }

  return output;
};

const convertFileToAttachment = (file: any, index: number): any => {
  try {
    const mediaType = file.mediaType || "application/octet-stream";
    const filename = `generated_file_${index}.${getExtensionFromMediaType(mediaType)}`;

    let blob: Blob | null = null;

    if (file.base64) {
      blob = convertDataToBlob(file.base64, mediaType);
    } else if (file.uint8Array) {
      blob = new Blob([file.uint8Array], { type: mediaType });
    }

    if (!blob) {
      console.warn(`Failed to convert file at index ${index} to Blob`);
      return file; // Return original if conversion fails
    }

    return new Attachment({
      data: blob,
      filename: filename,
      contentType: mediaType,
    });
  } catch (error) {
    console.warn(`Error processing file at index ${index}:`, error);
    return file; // Return original on error
  }
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

  // Prompt tokens (AI SDK v5 uses inputTokens)
  if (usage.inputTokens !== undefined) {
    metrics.prompt_tokens = usage.inputTokens;
  } else if (usage.promptTokens !== undefined) {
    metrics.prompt_tokens = usage.promptTokens;
  } else if (usage.prompt_tokens !== undefined) {
    metrics.prompt_tokens = usage.prompt_tokens;
  }

  // Completion tokens (AI SDK v5 uses outputTokens)
  if (usage.outputTokens !== undefined) {
    metrics.completion_tokens = usage.outputTokens;
  } else if (usage.completionTokens !== undefined) {
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

  // Prompt cached tokens (AI SDK v5 uses cachedInputTokens)
  if (
    usage.cachedInputTokens !== undefined ||
    usage.promptCachedTokens !== undefined ||
    usage.prompt_cached_tokens !== undefined
  ) {
    metrics.prompt_cached_tokens =
      usage.cachedInputTokens ||
      usage.promptCachedTokens ||
      usage.prompt_cached_tokens;
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
    usage.reasoningTokens !== undefined ||
    usage.completionReasoningTokens !== undefined ||
    usage.completion_reasoning_tokens !== undefined ||
    usage.reasoning_tokens !== undefined ||
    usage.thinkingTokens !== undefined ||
    usage.thinking_tokens !== undefined
  ) {
    const reasoningTokenCount =
      usage.reasoningTokens ||
      usage.completionReasoningTokens ||
      usage.completion_reasoning_tokens ||
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

const deepCopy = (obj: Record<string, unknown>) => {
  return JSON.parse(JSON.stringify(obj));
};

export const omit = (obj: Record<string, unknown>, paths: string[]) => {
  const result = deepCopy(obj);

  for (const path of paths) {
    const keys = path.split(".");
    let current = result;
    let pathExists = true;

    // Navigate to the parent of the property to remove
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        // Path doesn't exist, skip to next path
        pathExists = false;
        break;
      }
    }

    // Remove the final property only if the full path exists
    if (
      pathExists &&
      current &&
      typeof current === "object" &&
      keys.length > 0
    ) {
      const lastKey = keys[keys.length - 1];
      if (lastKey in current) {
        current[lastKey] = "<omitted>";
      }
    }
  }

  return result;
};
