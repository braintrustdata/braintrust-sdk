import { Attachment } from "../../logger";
import { getCurrentUnixTimestamp } from "../../util";
import type {
  GoogleGenAIGenerateContentParams,
  GoogleGenAIGenerateContentResponse,
  GoogleGenAIContent,
  GoogleGenAIPart,
  GoogleGenAIUsageMetadata,
} from "../../vendor-sdk-types/google-genai";

export function serializeInput(
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

export function extractMetadata(
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

export function extractGenerateContentMetrics(
  response: GoogleGenAIGenerateContentResponse | undefined,
  startTime?: number,
): Record<string, number> {
  const metrics: Record<string, number> = {};

  if (startTime !== undefined) {
    const end = getCurrentUnixTimestamp();
    metrics.start = startTime;
    metrics.end = end;
    metrics.duration = end - startTime;
  }

  if (response?.usageMetadata) {
    populateUsageMetrics(metrics, response.usageMetadata);
  }

  return metrics;
}

export function aggregateGenerateContentChunks(
  chunks: GoogleGenAIGenerateContentResponse[],
  startTime: number,
  firstTokenTime: number | null,
): {
  aggregated: Record<string, unknown>;
  metrics: Record<string, number>;
} {
  const end = getCurrentUnixTimestamp();
  const metrics: Record<string, number> = {
    start: startTime,
    end,
    duration: end - startTime,
  };

  if (firstTokenTime !== null) {
    metrics.time_to_first_token = firstTokenTime - startTime;
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

export function cleanMetrics(
  metrics: Record<string, number>,
): Record<string, number> {
  const cleaned: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (value !== null && value !== undefined) {
      cleaned[key] = value;
    }
  }
  return cleaned;
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

    if (
      data instanceof Uint8Array ||
      (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) ||
      typeof data === "string"
    ) {
      const extension = mimeType ? mimeType.split("/")[1] : "bin";
      const filename = `file.${extension}`;
      const buffer =
        typeof data === "string"
          ? typeof Buffer !== "undefined"
            ? Buffer.from(data, "base64")
            : new Uint8Array(
                atob(data)
                  .split("")
                  .map((char) => char.charCodeAt(0)),
              )
          : typeof Buffer !== "undefined"
            ? Buffer.from(data)
            : new Uint8Array(data);
      const arrayBuffer =
        buffer instanceof Uint8Array
          ? buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength,
            )
          : buffer;

      const attachment = new Attachment({
        data: arrayBuffer,
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

function tryToDict(obj: unknown): Record<string, unknown> | null {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (typeof obj === "object") {
    if (
      "toJSON" in obj &&
      typeof (obj as Record<string, unknown>).toJSON === "function"
    ) {
      return (obj as { toJSON: () => Record<string, unknown> }).toJSON();
    }
    return obj as Record<string, unknown>;
  }

  return null;
}
