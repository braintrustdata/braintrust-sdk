import { tracingChannel } from "dc-browser";
import { BasePlugin, isAsyncIterable, patchStreamIfNeeded } from "../core";
import type { StartEvent } from "../core";
import { startSpan, Attachment } from "../../logger";
import type { Span } from "../../logger";
import { SpanTypeAttribute, isObject } from "../../../util/index";
import { getCurrentUnixTimestamp } from "../../util";

/**
 * Auto-instrumentation plugin for the Google GenAI SDK.
 *
 * This plugin subscribes to orchestrion channels for Google GenAI SDK methods
 * and creates Braintrust spans to track:
 * - models.generateContent (non-streaming)
 * - models.generateContentStream (streaming)
 *
 * The plugin handles:
 * - Google-specific token metrics (promptTokenCount, candidatesTokenCount, cachedContentTokenCount)
 * - Processing streaming responses
 * - Converting inline data (images) to Attachment objects
 * - Tool calls (functionCall, functionResponse) and executable code results
 */
export class GoogleGenAIPlugin extends BasePlugin {
  protected unsubscribers: Array<() => void> = [];

  protected onEnable(): void {
    this.subscribeToGoogleGenAIChannels();
  }

  protected onDisable(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  private subscribeToGoogleGenAIChannels(): void {
    // GenerativeModel.generateContent (non-streaming)
    this.subscribeToChannel("orchestrion:google-genai:models.generateContent", {
      name: "google-genai.generateContent",
      type: SpanTypeAttribute.LLM,
      extractInput: (args: any[]) => {
        const params = args[0] || {};
        const input = serializeInput(params);
        const metadata = extractMetadata(params);
        return {
          input,
          metadata: { ...metadata, provider: "google-genai" },
        };
      },
      extractOutput: (result: any) => {
        return result;
      },
      extractMetrics: (result: any, startTime?: number) => {
        return extractGenerateContentMetrics(result, startTime);
      },
    });

    // GenerativeModel.generateContentStream (streaming)
    this.subscribeToGoogleStreamingChannel(
      "orchestrion:google-genai:models.generateContentStream",
      {
        name: "google-genai.generateContentStream",
        type: SpanTypeAttribute.LLM,
        extractInput: (args: any[]) => {
          const params = args[0] || {};
          const input = serializeInput(params);
          const metadata = extractMetadata(params);
          return {
            input,
            metadata: { ...metadata, provider: "google-genai" },
          };
        },
        aggregateChunks: aggregateGenerateContentChunks,
      },
    );
  }

  protected subscribeToChannel(
    channelName: string,
    config: {
      name: string;
      type: string;
      extractInput: (args: any[]) => { input: any; metadata: any };
      extractOutput: (result: any) => any;
      extractMetrics: (
        result: any,
        startTime?: number,
      ) => Record<string, number>;
    },
  ): void {
    const channel = tracingChannel(channelName);

    const spans = new WeakMap<any, { span: Span; startTime: number }>();

    const handlers = {
      start: (event: StartEvent) => {
        const span = startSpan({
          name: config.name,
          spanAttributes: {
            type: config.type,
          },
        });

        const startTime = getCurrentUnixTimestamp();
        spans.set(event, { span, startTime });

        try {
          const { input, metadata } = config.extractInput(event.arguments);
          span.log({
            input,
            metadata,
          });
        } catch (error) {
          console.error(`Error extracting input for ${channelName}:`, error);
        }
      },

      asyncEnd: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span, startTime } = spanData;

        try {
          const output = config.extractOutput(event.result);
          const metrics = config.extractMetrics(event.result, startTime);

          span.log({
            output,
            metrics,
          });
        } catch (error) {
          console.error(`Error extracting output for ${channelName}:`, error);
        } finally {
          span.end();
          spans.delete(event);
        }
      },

      error: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;

        span.log({
          error: event.error.message,
        });
        span.end();
        spans.delete(event);
      },
    };

    channel.subscribe(handlers);

    this.unsubscribers.push(() => {
      channel.unsubscribe(handlers);
    });
  }

  private subscribeToGoogleStreamingChannel(
    channelName: string,
    config: {
      name: string;
      type: string;
      extractInput: (args: any[]) => { input: any; metadata: any };
      aggregateChunks: (
        chunks: any[],
        startTime: number,
      ) => {
        output: any;
        metrics: Record<string, number>;
      };
    },
  ): void {
    const channel = tracingChannel(channelName);

    const spans = new WeakMap<any, { span: Span; startTime: number }>();

    const handlers = {
      start: (event: StartEvent) => {
        const span = startSpan({
          name: config.name,
          spanAttributes: {
            type: config.type,
          },
        });

        const startTime = getCurrentUnixTimestamp();
        spans.set(event, { span, startTime });

        try {
          const { input, metadata } = config.extractInput(event.arguments);
          span.log({
            input,
            metadata,
          });
        } catch (error) {
          console.error(`Error extracting input for ${channelName}:`, error);
        }
      },

      asyncEnd: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span, startTime } = spanData;

        // Check if result is a stream
        if (isAsyncIterable(event.result)) {
          // Patch the stream to collect chunks
          patchStreamIfNeeded(event.result, {
            onComplete: (chunks: any[]) => {
              try {
                const { output, metrics } = config.aggregateChunks(
                  chunks,
                  startTime,
                );

                span.log({
                  output,
                  metrics,
                });
              } catch (error) {
                console.error(
                  `Error extracting output for ${channelName}:`,
                  error,
                );
              } finally {
                span.end();
              }
            },
            onError: (error: Error) => {
              span.log({
                error: error.message,
              });
              span.end();
            },
          });
        } else {
          // Non-streaming response (shouldn't happen for generateContentStream)
          span.end();
          spans.delete(event);
        }
      },

      error: (event: any) => {
        const spanData = spans.get(event);
        if (!spanData) {
          return;
        }

        const { span } = spanData;

        span.log({
          error: event.error.message,
        });
        span.end();
        spans.delete(event);
      },
    };

    channel.subscribe(handlers);

    this.unsubscribers.push(() => {
      channel.unsubscribe(handlers);
    });
  }
}

/**
 * Serialize input parameters for Google GenAI API calls.
 */
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

/**
 * Serialize contents, converting inline data to Attachments.
 */
function serializeContents(contents: any): any {
  if (contents === null || contents === undefined) {
    return null;
  }

  if (Array.isArray(contents)) {
    return contents.map((item) => serializeContentItem(item));
  }

  return serializeContentItem(contents);
}

/**
 * Serialize a single content item.
 */
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

/**
 * Serialize a part, converting inline data to Attachments.
 */
function serializePart(part: any): any {
  if (!part || typeof part !== "object") {
    return part;
  }

  if (part.inlineData && part.inlineData.data) {
    const { data, mimeType } = part.inlineData;

    // Handle binary data (Uint8Array/Buffer) or base64 strings
    if (
      data instanceof Uint8Array ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) ||
      typeof data === "string"
    ) {
      const extension = mimeType ? mimeType.split("/")[1] : "bin";
      const filename = `file.${extension}`;

      // Convert to Buffer/Uint8Array - handles Uint8Array, Buffer, and base64 strings
      const buffer =
        typeof data === "string"
          ? typeof Buffer !== "undefined"
            ? Buffer.from(data, "base64")
            : new Uint8Array(
                atob(data)
                  .split("")
                  .map((c) => c.charCodeAt(0)),
              )
          : typeof Buffer !== "undefined"
            ? Buffer.from(data)
            : new Uint8Array(data);

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

/**
 * Serialize tools configuration.
 */
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

/**
 * Extract metadata from parameters.
 */
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

/**
 * Extract metrics from non-streaming generateContent response.
 */
function extractGenerateContentMetrics(
  response: any,
  startTime?: number,
): Record<string, number> {
  const metrics: Record<string, number> = {};

  if (startTime) {
    const end = getCurrentUnixTimestamp();
    metrics.duration = end - startTime;
  }

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

/**
 * Aggregate chunks from streaming generateContentStream response.
 */
function aggregateGenerateContentChunks(
  chunks: any[],
  startTime: number,
): {
  output: any;
  metrics: Record<string, number>;
} {
  const end = getCurrentUnixTimestamp();
  const metrics: Record<string, number> = {
    duration: end - startTime,
  };

  let firstTokenTime: number | null = null;

  if (chunks.length > 0 && firstTokenTime === null) {
    firstTokenTime = getCurrentUnixTimestamp();
    metrics.time_to_first_token = firstTokenTime - startTime;
  }

  if (chunks.length === 0) {
    return { output: {}, metrics };
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

  const output: any = {};

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
    output.candidates = candidates;
  }

  if (usageMetadata) {
    output.usageMetadata = usageMetadata;

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
    output.text = text;
  }

  return { output, metrics };
}

/**
 * Helper to convert objects to dictionaries.
 */
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
