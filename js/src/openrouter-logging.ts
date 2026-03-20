import { isObject } from "../util/index";
import { zodToJsonSchema } from "./zod/utils";
import { extractOpenRouterUsageMetadata } from "./openrouter-utils";
import type {
  OpenRouterCallModelRequest,
  OpenRouterEmbeddingResponse,
  OpenRouterResponse,
  OpenRouterTool,
} from "./vendor-sdk-types/openrouter";

const OMITTED_OPENROUTER_KEYS = new Set([
  "execute",
  "render",
  "nextTurnParams",
  "requireApproval",
]);

function parseOpenRouterModelString(model: unknown): {
  model: unknown;
  provider?: string;
} {
  if (typeof model !== "string") {
    return { model };
  }

  const slashIndex = model.indexOf("/");
  if (slashIndex > 0 && slashIndex < model.length - 1) {
    return {
      provider: model.substring(0, slashIndex),
      model: model.substring(slashIndex + 1),
    };
  }

  return { model };
}

function isZodSchema(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    "_def" in value &&
    typeof (value as { _def?: unknown })._def === "object"
  );
}

function serializeZodSchema(schema: unknown): Record<string, unknown> {
  try {
    return zodToJsonSchema(schema as any) as Record<string, unknown>;
  } catch {
    return {
      type: "object",
      description: "Zod schema (conversion failed)",
    };
  }
}

function serializeOpenRouterTool(tool: OpenRouterTool): OpenRouterTool {
  if (!isObject(tool)) {
    return tool;
  }

  const serialized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tool)) {
    if (OMITTED_OPENROUTER_KEYS.has(key)) {
      continue;
    }

    if (key === "function" && isObject(value)) {
      serialized.function = sanitizeOpenRouterLoggedValue(value);
      continue;
    }

    serialized[key] = sanitizeOpenRouterLoggedValue(value);
  }

  return serialized as OpenRouterTool;
}

function serializeOpenRouterToolsForLogging(
  tools: readonly OpenRouterTool[] | undefined,
): OpenRouterTool[] | undefined {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  return tools.map((tool) => serializeOpenRouterTool(tool));
}

export function sanitizeOpenRouterLoggedValue(value: unknown): unknown {
  if (isZodSchema(value)) {
    return serializeZodSchema(value);
  }

  if (typeof value === "function") {
    return "[Function]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeOpenRouterLoggedValue(entry));
  }

  if (!isObject(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (OMITTED_OPENROUTER_KEYS.has(key)) {
      continue;
    }

    if (key === "tools" && Array.isArray(entry)) {
      sanitized.tools = serializeOpenRouterToolsForLogging(entry);
      continue;
    }

    sanitized[key] = sanitizeOpenRouterLoggedValue(entry);
  }

  return sanitized;
}

export function buildOpenRouterMetadata(
  metadata: Record<string, unknown>,
  httpReferer: unknown,
  xTitle: unknown,
): Record<string, unknown> {
  const sanitized = sanitizeOpenRouterLoggedValue(metadata);
  const metadataRecord = isObject(sanitized) ? sanitized : {};
  const { model, provider: providerRouting, ...rest } = metadataRecord;
  const normalizedModel = parseOpenRouterModelString(model);

  return {
    ...rest,
    ...(normalizedModel.model !== undefined
      ? { model: normalizedModel.model }
      : {}),
    ...(providerRouting !== undefined ? { providerRouting } : {}),
    ...(httpReferer !== undefined ? { httpReferer } : {}),
    ...(xTitle !== undefined ? { xTitle } : {}),
    provider: normalizedModel.provider || "openrouter",
  };
}

export function buildOpenRouterEmbeddingMetadata(
  metadata: Record<string, unknown>,
  httpReferer: unknown,
  xTitle: unknown,
): Record<string, unknown> {
  const normalized = buildOpenRouterMetadata(metadata, httpReferer, xTitle);
  return typeof normalized.model === "string"
    ? {
        ...normalized,
        embedding_model: normalized.model,
      }
    : normalized;
}

export function extractOpenRouterCallModelInput(
  request: OpenRouterCallModelRequest,
): unknown {
  return isObject(request) && "input" in request
    ? sanitizeOpenRouterLoggedValue(request.input)
    : undefined;
}

export function extractOpenRouterCallModelMetadata(
  request: OpenRouterCallModelRequest,
): Record<string, unknown> {
  if (!isObject(request)) {
    return { provider: "openrouter" };
  }

  const { input: _input, ...metadata } = request;
  return buildOpenRouterMetadata(metadata, undefined, undefined);
}

export function extractOpenRouterResponseMetadata(
  result: OpenRouterResponse | OpenRouterEmbeddingResponse | undefined,
): Record<string, unknown> | undefined {
  if (!isObject(result)) {
    return undefined;
  }

  const { output: _output, data: _data, usage, ...metadata } = result;
  const sanitized = sanitizeOpenRouterLoggedValue(metadata);
  const metadataRecord = isObject(sanitized) ? sanitized : {};
  const { model, provider, ...rest } = metadataRecord;
  const normalizedModel = parseOpenRouterModelString(model);
  const normalizedProvider =
    (typeof provider === "string" ? provider : undefined) ||
    normalizedModel.provider;
  const usageMetadata = extractOpenRouterUsageMetadata(usage);
  const combined = {
    ...rest,
    ...(normalizedModel.model !== undefined
      ? { model: normalizedModel.model }
      : {}),
    ...(usageMetadata || {}),
    ...(normalizedProvider !== undefined
      ? { provider: normalizedProvider }
      : {}),
  };

  return Object.keys(combined).length > 0 ? combined : undefined;
}

export function extractOpenRouterResponseOutput(
  response: Record<string, unknown> | undefined,
  fallbackOutput?: unknown,
): unknown {
  if (
    isObject(response) &&
    "output" in response &&
    response.output !== undefined
  ) {
    return sanitizeOpenRouterLoggedValue(response.output);
  }

  if (fallbackOutput !== undefined) {
    return sanitizeOpenRouterLoggedValue(fallbackOutput);
  }

  return undefined;
}
