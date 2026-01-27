/* eslint-disable @typescript-eslint/no-explicit-any */
import { Span, traced, Attachment } from "../logger";
import { SpanTypeAttribute } from "../../util/index";
import { getCurrentUnixTimestamp } from "../util";

/**
 * Wrap a Google GenAI module (imported with `import * as googleGenAI from '@google/genai'`) to add tracing.
 * If Braintrust is not configured, nothing will be traced.
 *
 * @param googleGenAI The Google GenAI module
 * @returns The wrapped Google GenAI module
 *
 * @example
 * ```typescript
 * import * as googleGenAI from '@google/genai';
 * import { wrapGoogleGenAI, initLogger } from 'braintrust';
 *
 * initLogger({projectName: 'Your project' });
 * const { GoogleGenAI } } = wrapGoogleGenAI(googleGenAI);
 * const client = new GoogleGenAI({ apiKey: 'YOUR_API_KEY' });
 * ```
 */
export function wrapGoogleGenAI<T extends Record<string, any>>(
  googleGenAI: T,
): T {
  if (!googleGenAI || typeof googleGenAI !== "object") {
    console.warn("Invalid Google GenAI module. Not wrapping.");
    return googleGenAI;
  }

  if (!("GoogleGenAI" in googleGenAI)) {
    console.warn(
      "GoogleGenAI class not found in module. Not wrapping. Make sure you're passing the module itself (import * as googleGenAI from '@google/genai').",
    );
    return googleGenAI;
  }

  return new Proxy(googleGenAI, {
    get(target, prop, receiver) {
      if (prop === "GoogleGenAI") {
        const OriginalGoogleGenAI = Reflect.get(target, prop, receiver);
        return wrapGoogleGenAIClass(OriginalGoogleGenAI);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapGoogleGenAIClass(OriginalGoogleGenAI: any): any {
  return new Proxy(OriginalGoogleGenAI, {
    construct(target, args) {
      const instance = Reflect.construct(target, args);
      return wrapGoogleGenAIInstance(instance);
    },
  });
}

function wrapGoogleGenAIInstance(instance: any): any {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (prop === "models") {
        return wrapModels(Reflect.get(target, prop, receiver));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapModels(models: any): any {
  return new Proxy(models, {
    get(target, prop, receiver) {
      if (prop === "generateContent") {
        return wrapGenerateContent(target.generateContent.bind(target));
      } else if (prop === "generateContentStream") {
        return wrapGenerateContentStream(
          target.generateContentStream.bind(target),
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapGenerateContent(original: any): any {
  return async function (params: any) {
    const input = serializeInput(params);
    const metadata = extractMetadata(params);

    return traced(
      async (span: Span) => {
        const start = getCurrentUnixTimestamp();

        try {
          const result = await original(params);
          const metrics = extractGenerateContentMetrics(result, start);

          span.log({
            output: result,
            metrics: cleanMetrics(metrics),
          });

          return result;
        } catch (error) {
          span.log({
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
      {
        name: "generate_content",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input,
          metadata,
        },
      },
    );
  };
}

function wrapGenerateContentStream(original: any): any {
  return async function (params: any) {
    const input = serializeInput(params);
    const metadata = extractMetadata(params);

    const streamGenerator = await original(params);

    return asyncGeneratorProxy(streamGenerator, input, metadata);
  };
}

function asyncGeneratorProxy(
  generator: AsyncGenerator<any>,
  input: any,
  metadata: any,
): AsyncGenerator<any> {
  const chunks: any[] = [];
  const start = getCurrentUnixTimestamp();
  let firstTokenTime: number | null = null;
  let span: Span | null = null;

  return new Proxy(generator, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        const original = Reflect.get(target, prop, receiver);
        return function () {
          const iterator: AsyncIterator<any> = original.call(target);
          return new Proxy(iterator, {
            get(iterTarget, iterProp, iterReceiver) {
              if (iterProp === "next") {
                const originalNext = Reflect.get(
                  iterTarget,
                  iterProp,
                  iterReceiver,
                );
                return async function () {
                  if (span === null) {
                    span = traced((s: Span) => s, {
                      name: "generate_content_stream",
                      spanAttributes: {
                        type: SpanTypeAttribute.LLM,
                      },
                      event: {
                        input,
                        metadata,
                      },
                    });
                  }

                  try {
                    const result = await originalNext.call(iterTarget);

                    if (!result.done && result.value) {
                      if (firstTokenTime === null) {
                        firstTokenTime = getCurrentUnixTimestamp();
                      }
                      chunks.push(result.value);
                    }

                    if (result.done && span) {
                      const { aggregated, metrics } =
                        aggregateGenerateContentChunks(
                          chunks,
                          start,
                          firstTokenTime,
                        );

                      span.log({
                        output: aggregated,
                        metrics: cleanMetrics(metrics),
                      });
                      span.end();
                    }

                    return result;
                  } catch (error) {
                    if (span) {
                      span.log({
                        error:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      });
                      span.end();
                    }
                    throw error;
                  }
                };
              }
              return Reflect.get(iterTarget, iterProp, iterReceiver);
            },
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function serializeInput(params: any): any {
  const input: any = {
    model: params.model,
    contents: serializeContents(params.contents),
  };

  if (params.config) {
    const config = tryToDict(params.config);
    if (config) {
      const tools = serializeTools(params);
      if (tools) {
        config.tools = tools;
      }
      input.config = config;
    }
  }

  return input;
}

function serializeContents(contents: any): any {
  if (contents === null || contents === undefined) {
    return null;
  }

  if (Array.isArray(contents)) {
    return contents.map((item) => serializeContentItem(item));
  }

  return serializeContentItem(contents);
}

function serializeContentItem(item: any): any {
  if (typeof item === "object" && item !== null) {
    if (item.parts && Array.isArray(item.parts)) {
      return {
        ...item,
        parts: item.parts.map((part: any) => serializePart(part)),
      };
    }
    return item;
  }

  if (typeof item === "string") {
    return { text: item };
  }

  return item;
}

function serializePart(part: any): any {
  if (!part || typeof part !== "object") {
    return part;
  }

  if (part.inlineData && part.inlineData.data) {
    const { data, mimeType } = part.inlineData;

    // Handle binary data (Uint8Array/Buffer) or base64 strings
    if (
      data instanceof Uint8Array ||
      Buffer.isBuffer(data) ||
      typeof data === "string"
    ) {
      const extension = mimeType ? mimeType.split("/")[1] : "bin";
      const filename = `file.${extension}`;

      // Convert to Buffer - handles Uint8Array, Buffer, and base64 strings
      const buffer =
        typeof data === "string"
          ? Buffer.from(data, "base64")
          : Buffer.from(data);

      const attachment = new Attachment({
        data: buffer as unknown as ArrayBuffer,
        filename,
        contentType: mimeType || "application/octet-stream",
      });

      return {
        image_url: { url: attachment },
      };
    }
  }

  return part;
}

function serializeTools(params: any): any[] | null {
  if (!params.config?.tools) {
    return null;
  }

  try {
    return params.config.tools.map((tool: any) => {
      if (typeof tool === "object" && tool.functionDeclarations) {
        return tool;
      }
      return tool;
    });
  } catch {
    return null;
  }
}

function extractMetadata(params: any): any {
  const metadata: any = {};

  if (params.model) {
    metadata.model = params.model;
  }

  if (params.config) {
    const config = tryToDict(params.config);
    if (config) {
      Object.keys(config).forEach((key) => {
        if (key !== "tools") {
          metadata[key] = config[key];
        }
      });
    }
  }

  return metadata;
}

function extractGenerateContentMetrics(response: any, start: number): any {
  const end = getCurrentUnixTimestamp();
  const metrics: any = {
    start,
    end,
    duration: end - start,
  };

  if (response.usageMetadata) {
    const usage = response.usageMetadata;

    if (usage.promptTokenCount !== undefined) {
      metrics.prompt_tokens = usage.promptTokenCount;
    }
    if (usage.candidatesTokenCount !== undefined) {
      metrics.completion_tokens = usage.candidatesTokenCount;
    }
    if (usage.totalTokenCount !== undefined) {
      metrics.tokens = usage.totalTokenCount;
    }
    if (usage.cachedContentTokenCount !== undefined) {
      metrics.prompt_cached_tokens = usage.cachedContentTokenCount;
    }
    if (usage.thoughtsTokenCount !== undefined) {
      metrics.completion_reasoning_tokens = usage.thoughtsTokenCount;
    }
  }

  return metrics;
}

function aggregateGenerateContentChunks(
  chunks: any[],
  start: number,
  firstTokenTime: number | null,
): { aggregated: any; metrics: any } {
  const end = getCurrentUnixTimestamp();
  const metrics: any = {
    start,
    end,
    duration: end - start,
  };

  if (firstTokenTime !== null) {
    metrics.time_to_first_token = firstTokenTime - start;
  }

  if (chunks.length === 0) {
    return { aggregated: {}, metrics };
  }

  let text = "";
  let thoughtText = "";
  const otherParts: any[] = [];
  let usageMetadata: any = null;
  let lastResponse: any = null;

  for (const chunk of chunks) {
    lastResponse = chunk;

    if (chunk.usageMetadata) {
      usageMetadata = chunk.usageMetadata;
    }

    if (chunk.candidates && Array.isArray(chunk.candidates)) {
      for (const candidate of chunk.candidates) {
        if (candidate.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text !== undefined) {
              if (part.thought) {
                thoughtText += part.text;
              } else {
                text += part.text;
              }
            } else if (part.functionCall) {
              otherParts.push({ functionCall: part.functionCall });
            } else if (part.codeExecutionResult) {
              otherParts.push({
                codeExecutionResult: part.codeExecutionResult,
              });
            } else if (part.executableCode) {
              otherParts.push({ executableCode: part.executableCode });
            }
          }
        }
      }
    }
  }

  const aggregated: any = {};

  const parts: any[] = [];
  if (thoughtText) {
    parts.push({ text: thoughtText, thought: true });
  }
  if (text) {
    parts.push({ text });
  }
  parts.push(...otherParts);

  if (parts.length > 0 && lastResponse?.candidates) {
    const candidates: any[] = [];
    for (const candidate of lastResponse.candidates) {
      const candidateDict: any = {
        content: {
          parts,
          role: "model",
        },
      };

      if (candidate.finishReason !== undefined) {
        candidateDict.finishReason = candidate.finishReason;
      }
      if (candidate.safetyRatings) {
        candidateDict.safetyRatings = candidate.safetyRatings;
      }

      candidates.push(candidateDict);
    }
    aggregated.candidates = candidates;
  }

  if (usageMetadata) {
    aggregated.usageMetadata = usageMetadata;

    if (usageMetadata.promptTokenCount !== undefined) {
      metrics.prompt_tokens = usageMetadata.promptTokenCount;
    }
    if (usageMetadata.candidatesTokenCount !== undefined) {
      metrics.completion_tokens = usageMetadata.candidatesTokenCount;
    }
    if (usageMetadata.totalTokenCount !== undefined) {
      metrics.tokens = usageMetadata.totalTokenCount;
    }
    if (usageMetadata.cachedContentTokenCount !== undefined) {
      metrics.prompt_cached_tokens = usageMetadata.cachedContentTokenCount;
    }
    if (usageMetadata.thoughtsTokenCount !== undefined) {
      metrics.completion_reasoning_tokens = usageMetadata.thoughtsTokenCount;
    }
  }

  if (text) {
    aggregated.text = text;
  }

  return { aggregated, metrics };
}

function cleanMetrics(metrics: any): any {
  const cleaned: any = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function tryToDict(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (typeof obj === "object") {
    if (typeof obj.toJSON === "function") {
      return obj.toJSON();
    }
    return obj;
  }

  return null;
}
