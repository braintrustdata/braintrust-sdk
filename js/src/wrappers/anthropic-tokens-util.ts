/**
 * Shared utility for Anthropic token calculations.
 *
 * Anthropic's token counting doesn't include cache tokens in total tokens and we need to do the math ourselves.
 */

export interface AnthropicTokenMetrics {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cached_tokens?: number;
  prompt_cache_creation_tokens?: number;
  tokens?: number;
  [key: string]: number | undefined;
}

export function finalizeAnthropicTokens(
  metrics: AnthropicTokenMetrics,
): AnthropicTokenMetrics {
  const prompt_tokens =
    (metrics.prompt_tokens || 0) +
    (metrics.prompt_cached_tokens || 0) +
    (metrics.prompt_cache_creation_tokens || 0);

  return {
    ...metrics,
    prompt_tokens,
    tokens: prompt_tokens + (metrics.completion_tokens || 0),
  };
}

export function extractAnthropicCacheTokens(
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
): Partial<AnthropicTokenMetrics> {
  const cacheTokens: Partial<AnthropicTokenMetrics> = {};

  if (cacheReadTokens > 0) {
    cacheTokens.prompt_cached_tokens = cacheReadTokens;
  }

  if (cacheCreationTokens > 0) {
    cacheTokens.prompt_cache_creation_tokens = cacheCreationTokens;
  }

  return cacheTokens;
}
