import { isObject } from "../util/index";

const TOKEN_NAME_MAP: Record<string, string> = {
  promptTokens: "prompt_tokens",
  inputTokens: "prompt_tokens",
  completionTokens: "completion_tokens",
  outputTokens: "completion_tokens",
  totalTokens: "tokens",
  prompt_tokens: "prompt_tokens",
  input_tokens: "prompt_tokens",
  completion_tokens: "completion_tokens",
  output_tokens: "completion_tokens",
  total_tokens: "tokens",
};

const TOKEN_DETAIL_PREFIX_MAP: Record<string, string> = {
  promptTokensDetails: "prompt",
  inputTokensDetails: "prompt",
  completionTokensDetails: "completion",
  outputTokensDetails: "completion",
  costDetails: "cost",
  prompt_tokens_details: "prompt",
  input_tokens_details: "prompt",
  completion_tokens_details: "completion",
  output_tokens_details: "completion",
  cost_details: "cost",
};

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

export function parseOpenRouterMetricsFromUsage(
  usage: unknown,
): Record<string, number> {
  if (!isObject(usage)) {
    return {};
  }

  const metrics: Record<string, number> = {};

  for (const [name, value] of Object.entries(usage)) {
    if (typeof value === "number") {
      metrics[TOKEN_NAME_MAP[name] || camelToSnake(name)] = value;
      continue;
    }

    if (!isObject(value)) {
      continue;
    }

    const prefix = TOKEN_DETAIL_PREFIX_MAP[name];
    if (!prefix) {
      continue;
    }

    for (const [nestedName, nestedValue] of Object.entries(value)) {
      if (typeof nestedValue !== "number") {
        continue;
      }

      metrics[`${prefix}_${camelToSnake(nestedName)}`] = nestedValue;
    }
  }

  return metrics;
}

export function extractOpenRouterUsageMetadata(
  usage: unknown,
): Record<string, unknown> | undefined {
  if (!isObject(usage)) {
    return undefined;
  }

  const metadata: Record<string, unknown> = {};

  if (typeof usage.isByok === "boolean") {
    metadata.is_byok = usage.isByok;
  } else if (typeof usage.is_byok === "boolean") {
    metadata.is_byok = usage.is_byok;
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}
