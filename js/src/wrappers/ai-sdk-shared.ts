import {
  extractAnthropicCacheTokens,
  finalizeAnthropicTokens,
} from "./anthropic-tokens-util";
import { wrapTraced } from "../logger";

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

// -------- Chat completion formatting helpers --------

export function normalizeFinishReason(reason: any): string | undefined {
  if (typeof reason !== "string") return undefined;
  return reason.replace(/-/g, "_");
}

export function extractToolCallsFromSteps(steps: any[] | undefined) {
  const toolCalls: any[] = [];
  if (!Array.isArray(steps)) return toolCalls;
  let idx = 0;
  for (const step of steps) {
    const blocks: any[] | undefined = (step as any)?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (
        block &&
        typeof block === "object" &&
        (block as any).type === "tool-call"
      ) {
        toolCalls.push({
          id: (block as any).toolCallId,
          type: "function",
          index: idx++,
          function: {
            name: (block as any).toolName,
            arguments:
              typeof (block as any).input === "string"
                ? (block as any).input
                : JSON.stringify((block as any).input ?? {}),
          },
        });
      }
    }
  }
  return toolCalls;
}

export function buildAssistantOutputWithToolCalls(
  result: any,
  toolCalls: any[],
) {
  return [
    {
      index: 0,
      logprobs: null,
      finish_reason:
        normalizeFinishReason(result?.finishReason) ??
        (toolCalls.length ? "tool_calls" : undefined),
      message: {
        role: "assistant",
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    },
  ];
}

// Convenience: extract tool calls directly from a blocks array (e.g., result.content)
export function extractToolCallsFromBlocks(blocks: any[] | undefined) {
  if (!Array.isArray(blocks)) return [];
  return extractToolCallsFromSteps([{ content: blocks }] as any);
}

// Build tool-result messages from steps to display tool outputs inline
export function extractToolResultChoicesFromSteps(
  steps: any[] | undefined,
): any[] {
  const choices: any[] = [];
  if (!Array.isArray(steps)) return choices;
  for (const step of steps) {
    const blocks: any[] | undefined = (step as any)?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (
        block &&
        typeof block === "object" &&
        (block as any).type === "tool-result"
      ) {
        const b: any = block as any;
        const raw =
          b.output &&
          typeof b.output === "object" &&
          "type" in b.output &&
          b.output.type === "json"
            ? b.output.value
            : b.output ?? {};
        const content = typeof raw === "string" ? raw : JSON.stringify(raw);
        choices.push({
          index: 0,
          logprobs: null,
          message: {
            role: "tool",
            tool_call_id: b.toolCallId,
            content,
          },
        });
      }
    }
  }
  return choices;
}

// Extract the final assistant text message from steps (fallback to result.text)
export function extractFinalAssistantTextChoice(
  steps: any[] | undefined,
  resultText?: string,
): any | undefined {
  if (Array.isArray(steps)) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const blocks: any[] | undefined = (steps[i] as any)?.content;
      if (!Array.isArray(blocks)) continue;
      for (let j = blocks.length - 1; j >= 0; j--) {
        const b = blocks[j];
        if (b && typeof b === "object" && (b as any).type === "text") {
          return {
            index: 0,
            logprobs: null,
            message: { role: "assistant", content: [b] },
          };
        }
      }
    }
  }
  if (typeof resultText === "string" && resultText.length > 0) {
    return {
      index: 0,
      logprobs: null,
      message: {
        role: "assistant",
        content: [{ type: "text", text: resultText }],
      },
    };
  }
  return undefined;
}

export function buildAssistantOutputFromSteps(
  result: any,
  steps: any[] | undefined,
) {
  const out: any[] = [];

  if (Array.isArray(steps) && steps.length > 0) {
    for (const step of steps) {
      const stepToolCalls = extractToolCallsFromSteps([step]);
      if (stepToolCalls.length > 0) {
        const header = buildAssistantOutputWithToolCalls(
          { finishReason: (step as any)?.finishReason ?? result?.finishReason },
          stepToolCalls,
        );
        out.push(...header);
      }

      const stepToolResults = extractToolResultChoicesFromSteps([step]);
      if (stepToolResults.length > 0) {
        out.push(...stepToolResults);
      }
    }
  } else {
    const toolCalls = extractToolCallsFromSteps(steps);
    out.push(...buildAssistantOutputWithToolCalls(result, toolCalls));
  }

  const finalAssistant = extractFinalAssistantTextChoice(steps, result?.text);
  if (finalAssistant) out.push(finalAssistant);

  return out;
}

export function wrapTools<
  TTools extends Record<string, unknown> | unknown[] | undefined,
>(tools: TTools): TTools {
  if (!tools) return tools;

  // Helper to infer a useful tool name
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inferName = (tool: any, fallback: string) =>
    (tool && (tool.name || tool.toolName || tool.id)) || fallback;

  // Array form: return a shallow-cloned array with wrapped executes
  if (Array.isArray(tools)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = tools as any[];
    const out = arr.map((tool, idx) => {
      if (
        tool != null &&
        typeof tool === "object" &&
        "execute" in tool &&
        typeof (tool as any).execute === "function"
      ) {
        const name = inferName(tool, `tool[${idx}]`);
        return {
          ...(tool as object),
          execute: wrapTraced((tool as any).execute.bind(tool), {
            name,
            type: "tool",
          }),
        };
      }
      return tool;
    });
    return out as unknown as TTools;
  }

  // Object form: avoid mutating the original tool objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedTools: Record<string, any> = {};
  for (const [key, tool] of Object.entries(tools as Record<string, unknown>)) {
    if (
      tool != null &&
      typeof tool === "object" &&
      "execute" in tool &&
      typeof (tool as any).execute === "function"
    ) {
      wrappedTools[key] = {
        ...(tool as object),
        execute: wrapTraced((tool as any).execute.bind(tool), {
          name: key,
          type: "tool",
        }),
      };
    } else {
      wrappedTools[key] = tool;
    }
  }
  return wrappedTools as unknown as TTools;
}
