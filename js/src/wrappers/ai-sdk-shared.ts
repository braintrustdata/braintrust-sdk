import {
  extractAnthropicCacheTokens,
  finalizeAnthropicTokens,
} from "./anthropic-tokens-util";

/**
 * Shared utility functions for AI SDK wrappers
 */

export function detectProviderFromResult(result: {
  providerMetadata?: Record<string, unknown>;
}): string | undefined {
  if (!result?.providerMetadata) {
    return undefined;
  }

  const keys = Object.keys(result.providerMetadata);
  return keys?.at(0);
}

export function extractModelFromResult(result: {
  response?: { modelId?: string };
  request?: { body?: { model?: string } };
}): string | undefined {
  if (result?.response?.modelId) {
    return result.response.modelId;
  }

  if (result?.request?.body?.model) {
    return result.request.body.model;
  }

  return undefined;
}

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function extractModelParameters(
  params: Record<string, unknown>,
  excludeKeys: Set<string>,
): Record<string, unknown> {
  const modelParams: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && !excludeKeys.has(key)) {
      const snakeKey = camelToSnake(key);
      modelParams[snakeKey] = value;
    }
  }

  return modelParams;
}

export function getNumberProperty(
  obj: unknown,
  key: string,
): number | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) {
    return undefined;
  }
  const value = Reflect.get(obj, key);
  return typeof value === "number" ? value : undefined;
}

export function normalizeUsageMetrics(
  usage: unknown,
  provider?: string,
  providerMetadata?: Record<string, unknown>,
): Record<string, number> {
  const metrics: Record<string, number> = {};

  // Standard AI SDK usage fields
  const inputTokens = getNumberProperty(usage, "inputTokens");
  if (inputTokens !== undefined) {
    metrics.prompt_tokens = inputTokens;
  }

  const outputTokens = getNumberProperty(usage, "outputTokens");
  if (outputTokens !== undefined) {
    metrics.completion_tokens = outputTokens;
  }

  const totalTokens = getNumberProperty(usage, "totalTokens");
  if (totalTokens !== undefined) {
    metrics.tokens = totalTokens;
  }

  const reasoningTokens = getNumberProperty(usage, "reasoningTokens");
  if (reasoningTokens !== undefined) {
    metrics.completion_reasoning_tokens = reasoningTokens;
  }

  const cachedInputTokens = getNumberProperty(usage, "cachedInputTokens");
  if (cachedInputTokens !== undefined) {
    metrics.prompt_cached_tokens = cachedInputTokens;
  }

  // Anthropic-specific cache token handling
  if (provider === "anthropic") {
    const anthropicMetadata = providerMetadata?.anthropic as any;

    if (anthropicMetadata) {
      const cacheReadTokens =
        getNumberProperty(anthropicMetadata.usage, "cache_read_input_tokens") ||
        0;
      const cacheCreationTokens =
        getNumberProperty(
          anthropicMetadata.usage,
          "cache_creation_input_tokens",
        ) || 0;

      const cacheTokens = extractAnthropicCacheTokens(
        cacheReadTokens,
        cacheCreationTokens,
      );
      Object.assign(metrics, cacheTokens);

      Object.assign(metrics, finalizeAnthropicTokens(metrics));
    }
  }

  return metrics;
}
