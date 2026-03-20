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

export function serializeOpenRouterToolsForLogging(
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
  const { provider: providerRouting, ...rest } = metadataRecord;

  return {
    ...rest,
    ...(providerRouting !== undefined ? { providerRouting } : {}),
    ...(httpReferer !== undefined ? { httpReferer } : {}),
    ...(xTitle !== undefined ? { xTitle } : {}),
    provider: "openrouter",
  };
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
  const usageMetadata = extractOpenRouterUsageMetadata(usage);
  const combined = {
    ...(isObject(sanitized) ? sanitized : {}),
    ...(usageMetadata || {}),
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
