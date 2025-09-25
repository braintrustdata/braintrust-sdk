import { z } from "zod/v3";

/**
 * Token-related metrics for LLM operations.
 * These metrics are typically extracted from LLM API responses.
 */
export const TokenMetricsSchema = z.object({
  /** Number of tokens in the input/prompt */
  prompt_tokens: z.number().optional(),
  /** Number of tokens in the output/completion */
  completion_tokens: z.number().optional(),
  /** Total token count (prompt + completion) */
  tokens: z.number().optional(),
  /** Number of tokens read from prompt cache */
  prompt_cached_tokens: z.number().optional(),
  /** Number of tokens used to write/create prompt cache */
  prompt_cache_creation_tokens: z.number().optional(),
  /** Number of tokens used for reasoning in prompts (e.g., o1 models) */
  prompt_reasoning_tokens: z.number().optional(),
  /** Number of cached tokens in completion */
  completion_cached_tokens: z.number().optional(),
  /** Number of tokens used for reasoning in completion */
  completion_reasoning_tokens: z.number().optional(),
  /** Number of audio tokens in completion (multimodal) */
  completion_audio_tokens: z.number().optional(),
  /** Time from request start to first token received (in seconds) */
  time_to_first_token: z.number().optional(),
});

export type TokenMetrics = z.infer<typeof TokenMetricsSchema>;

/**
 * Timing and performance metrics.
 * These metrics track the latency and duration of operations.
 */
export const TimingMetricsSchema = z.object({
  /** Unix timestamp (in seconds) when the operation started */
  start: z.number().optional(),
  /** Unix timestamp (in seconds) when the operation ended */
  end: z.number().optional(),
  /** Total duration in seconds (calculated as end - start) */
  duration: z.number().optional(),
});

export type TimingMetrics = z.infer<typeof TimingMetricsSchema>;

/**
 * Standard metrics that don't fit into token or timing categories.
 */
export const OtherMetricsSchema = z.object({
  cached: z.number().optional(),
});

export type OtherMetrics = z.infer<typeof OtherMetricsSchema>;

/**
 * Combined standard metrics schema.
 * Merges all fields from TokenMetrics, TimingMetrics, and OtherMetrics.
 */
export const StandardMetricsSchema = z.object({
  ...TokenMetricsSchema.shape,
  ...TimingMetricsSchema.shape,
  ...OtherMetricsSchema.shape,
});

export type StandardMetrics = z.infer<typeof StandardMetricsSchema>;
export const MetricsSchema = StandardMetricsSchema.partial().passthrough();
export type Metrics = z.infer<typeof MetricsSchema>;
