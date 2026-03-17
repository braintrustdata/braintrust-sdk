import { Span, traced, Attachment, startSpan } from "../logger";
import { SpanTypeAttribute } from "../../util/index";
import { getCurrentUnixTimestamp } from "../util";
import type {
  GoogleGenAIClient,
  GoogleGenAIConstructor,
  GoogleGenAIGenerateContentParams,
  GoogleGenAIGenerateContentResponse,
  GoogleGenAIModels,
  GoogleGenAIPart,
  GoogleGenAIContent,
  GoogleGenAIUsageMetadata,
} from "../vendor-sdk-types/google-genai";

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
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const OriginalGoogleGenAI = Reflect.get(
          target,
          prop,
          receiver,
        ) as GoogleGenAIConstructor;
        return wrapGoogleGenAIClass(OriginalGoogleGenAI);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapGoogleGenAIClass(
  OriginalGoogleGenAI: GoogleGenAIConstructor,
): GoogleGenAIConstructor {
  return new Proxy(OriginalGoogleGenAI, {
    construct(target, args) {
      const instance = Reflect.construct(target, args);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return wrapGoogleGenAIInstance(instance as GoogleGenAIClient);
    },
  });
}

function wrapGoogleGenAIInstance(
  instance: GoogleGenAIClient,
): GoogleGenAIClient {
  return new Proxy(instance, {
    get(target, prop, receiver) {
      if (prop === "models") {
        return wrapModels(target.models);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapModels(models: GoogleGenAIModels): GoogleGenAIModels {
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

function wrapGenerateContent(
  original: GoogleGenAIModels["generateContent"],
): GoogleGenAIModels["generateContent"] {
  return async function (params: GoogleGenAIGenerateContentParams) {
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

function wrapGenerateContentStream(
  original: GoogleGenAIModels["generateContentStream"],
): GoogleGenAIModels["generateContentStream"] {
  return async function (params: GoogleGenAIGenerateContentParams) {
    const input = serializeInput(params);
    const metadata = extractMetadata(params);

    const streamGenerator = await original(params);

    return asyncGeneratorProxy(streamGenerator, input, metadata);
  };
}

function asyncGeneratorProxy(
  generator: AsyncGenerator<GoogleGenAIGenerateContentResponse>,
  input: Record<string, unknown>,
  metadata: Record<string, unknown>,
): AsyncGenerator<GoogleGenAIGenerateContentResponse> {
  const chunks: GoogleGenAIGenerateContentResponse[] = [];
  const start = getCurrentUnixTimestamp();
  let firstTokenTime: number | null = null;
  let span: Span | null = null;
  let finalized = false;

  const ensureSpan = () => {
    if (span === null) {
      span = startSpan({
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

    return span;
  };

  const finalizeSpan = ({
    error,
    result,
  }: {
    error?: unknown;
    result?: {
      aggregated: Record<string, unknown>;
      metrics: Record<string, number>;
    };
  }) => {
    if (finalized || span === null) {
      return;
    }

    finalized = true;

    if (result) {
      const { end, ...metricsWithoutEnd } = result.metrics;
      span.log({
        output: result.aggregated,
        metrics: cleanMetrics(metricsWithoutEnd),
      });
      span.end(typeof end === "number" ? { endTime: end } : undefined);
      return;
    }

    if (error !== undefined) {
      span.log({
        error: error instanceof Error ? error.message : String(error),
      });
    }

    span.end();
  };

  return new Proxy(generator, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const original = Reflect.get(
          target,
          prop,
          receiver,
        ) as () => AsyncIterator<GoogleGenAIGenerateContentResponse>;
        return function () {
          const iterator: AsyncIterator<GoogleGenAIGenerateContentResponse> =
            original.call(target);
          return new Proxy(iterator, {
            get(iterTarget, iterProp, iterReceiver) {
              if (iterProp === "next") {
                const originalNext = Reflect.get(
                  iterTarget,
                  iterProp,
                  iterReceiver,
                );
                return async function () {
                  ensureSpan();

                  try {
                    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                    const result = (await originalNext.call(
                      iterTarget,
                    )) as IteratorResult<GoogleGenAIGenerateContentResponse>;

                    if (!result.done && result.value) {
                      if (firstTokenTime === null) {
                        firstTokenTime = getCurrentUnixTimestamp();
                      }
                      chunks.push(result.value);
                    }

                    if (result.done && span) {
                      finalizeSpan({
                        result: aggregateGenerateContentChunks(
                          chunks,
                          start,
                          firstTokenTime,
                        ),
                      });
                    }

                    return result;
                  } catch (error) {
                    finalizeSpan({ error });
                    throw error;
                  }
                };
              }
              if (iterProp === "return") {
                const originalReturn = Reflect.get(
                  iterTarget,
                  iterProp,
                  iterReceiver,
                );
                if (typeof originalReturn !== "function") {
                  return originalReturn;
                }

                return async function (...args: [] | [unknown]) {
                  ensureSpan();
                  try {
                    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                    return (await originalReturn.call(
                      iterTarget,
                      ...args,
                    )) as IteratorResult<GoogleGenAIGenerateContentResponse>;
                  } finally {
                    finalizeSpan({
                      result:
                        chunks.length > 0
                          ? aggregateGenerateContentChunks(
                              chunks,
                              start,
                              firstTokenTime,
                            )
                          : undefined,
                    });
                  }
                };
              }
              if (iterProp === "throw") {
                const originalThrow = Reflect.get(
                  iterTarget,
                  iterProp,
                  iterReceiver,
                );
                if (typeof originalThrow !== "function") {
                  return originalThrow;
                }

                return async function (...args: [] | [unknown]) {
                  ensureSpan();
                  try {
                    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
                    return (await originalThrow.call(
                      iterTarget,
                      ...args,
                    )) as IteratorResult<GoogleGenAIGenerateContentResponse>;
                  } catch (error) {
                    finalizeSpan({ error });
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

function serializeInput(
  params: GoogleGenAIGenerateContentParams,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    model: params.model,
    contents: serializeContents(params.contents),
  };

  if (params.config) {
    const config = tryToDict(params.config);
    if (config) {
      const filteredConfig: Record<string, unknown> = {};
      Object.keys(config).forEach((key) => {
        if (key !== "tools") {
          filteredConfig[key] = config[key];
        }
      });
      input.config = filteredConfig;
    }
  }

  return input;
}

function serializeContents(
  contents: GoogleGenAIGenerateContentParams["contents"],
): unknown {
  if (contents === null || contents === undefined) {
    return null;
  }

  if (Array.isArray(contents)) {
    return contents.map((item) => serializeContentItem(item));
  }

  return serializeContentItem(contents);
}

function serializeContentItem(item: string | GoogleGenAIContent): unknown {
  if (typeof item === "object" && item !== null) {
    if (item.parts && Array.isArray(item.parts)) {
      return {
        ...item,
        parts: item.parts.map((part: GoogleGenAIPart) => serializePart(part)),
      };
    }
    return item;
  }

  if (typeof item === "string") {
    return { text: item };
  }

  return item;
}

function serializePart(part: GoogleGenAIPart): unknown {
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

      // Convert to ArrayBuffer - handles Uint8Array, Buffer, and base64 strings
      const buffer =
        typeof data === "string"
          ? Buffer.from(data, "base64")
          : Buffer.from(data);

      const attachment = new Attachment({
        data: buffer,
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

function serializeTools(
  params: GoogleGenAIGenerateContentParams,
): Record<string, unknown>[] | null {
  if (!params.config?.tools) {
    return null;
  }

  try {
    return params.config.tools.map((tool) => {
      if (typeof tool === "object" && tool.functionDeclarations) {
        return tool;
      }
      return tool;
    });
  } catch {
    return null;
  }
}

function extractMetadata(
  params: GoogleGenAIGenerateContentParams,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

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

  const tools = serializeTools(params);
  if (tools) {
    metadata.tools = tools;
  }

  return metadata;
}

function extractGenerateContentMetrics(
  response: GoogleGenAIGenerateContentResponse,
  start: number,
): Record<string, number> {
  const end = getCurrentUnixTimestamp();
  const metrics: Record<string, number> = {
    start,
    end,
    duration: end - start,
  };

  if (response.usageMetadata) {
    populateUsageMetrics(metrics, response.usageMetadata);
  }

  return metrics;
}

function populateUsageMetrics(
  metrics: Record<string, number>,
  usage: GoogleGenAIUsageMetadata,
): void {
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

function aggregateGenerateContentChunks(
  chunks: GoogleGenAIGenerateContentResponse[],
  start: number,
  firstTokenTime: number | null,
): { aggregated: Record<string, unknown>; metrics: Record<string, number> } {
  const end = getCurrentUnixTimestamp();
  const metrics: Record<string, number> = {
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
  const otherParts: Record<string, unknown>[] = [];
  let usageMetadata: GoogleGenAIUsageMetadata | null = null;
  let lastResponse: GoogleGenAIGenerateContentResponse | null = null;

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

  const aggregated: Record<string, unknown> = {};

  const parts: Record<string, unknown>[] = [];
  if (thoughtText) {
    parts.push({ text: thoughtText, thought: true });
  }
  if (text) {
    parts.push({ text });
  }
  parts.push(...otherParts);

  if (parts.length > 0 && lastResponse?.candidates) {
    const candidates: Record<string, unknown>[] = [];
    for (const candidate of lastResponse.candidates) {
      const candidateDict: Record<string, unknown> = {
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
    populateUsageMetrics(metrics, usageMetadata);
  }

  if (text) {
    aggregated.text = text;
  }

  return { aggregated, metrics };
}

function cleanMetrics(metrics: Record<string, number>): Record<string, number> {
  const cleaned: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function tryToDict(obj: unknown): Record<string, unknown> | null {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (typeof obj === "object") {
    if (
      "toJSON" in obj &&
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      typeof (obj as Record<string, unknown>).toJSON === "function"
    ) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return (obj as { toJSON: () => Record<string, unknown> }).toJSON();
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return obj as Record<string, unknown>;
  }

  return null;
}
