/* eslint-disable @typescript-eslint/consistent-type-assertions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  startSpan,
  traced,
  withCurrent,
  logError,
  wrapTraced,
} from "../../logger";
import {
  extractAnthropicCacheTokens,
  finalizeAnthropicTokens,
} from "../anthropic-tokens-util";
let aiSDKFormatWarning = false;

/*
MastraAgentMethods is a neutral interface for the Mastra agent methods we use.
This avoids importing `typeof import("mastra")`, which can cause type-identity
conflicts when multiple copies/versions of `mastra` exist in the workspace.
*/
interface MastraAgentMethods {
  name?: string;
  tools?: Record<string, unknown> | unknown[];
  model?: any; // The language model used by the agent
  __setTools(tools: Record<string, unknown> | unknown[]): void;
  generate?: (params: any) => any;
  stream?: (params: any) => any;
}

/**
 * Wraps a Mastra agent with Braintrust tracing. This function wraps the agent's
 * underlying language model with BraintrustMiddleware and traces all agent method calls.
 *
 * **Important**: This wrapper only supports AI SDK v5 methods such as `generate` and `stream`.
 *
 * @param agent - The Mastra agent to wrap
 * @param options - Optional configuration for the wrapper
 * @returns The wrapped agent with Braintrust tracing
 *
 * @example
 * ```typescript
 * import { wrapMastraAgent } from "braintrust";
 * import { Agent } from "@mastra/core/agent";
 * import { openai } from "@ai-sdk/openai";
 *
 * const agent = new Agent({
 *   name: "Assistant",
 *   model: openai("gpt-4"),
 *   instructions: "You are a helpful assistant."
 * });
 *
 * const wrappedAgent = wrapMastraAgent(agent);
 * ```
 */
export function wrapMastraAgent<T extends MastraAgentMethods>(
  agent: T,
  options?: { name?: string; span_name?: string },
): T {
  const prefix = options?.name ?? options?.span_name ?? agent.name ?? "Agent";

  if (!hasAllMethods(agent)) {
    return agent;
  }

  if (agent.tools) {
    agent.__setTools(wrapTools(agent.tools));
  }

  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);

      if (prop === "generate" && typeof value === "function") {
        return wrapGenerate(value, target, prefix);
      }

      if (prop === "stream" && typeof value === "function") {
        return wrapStream(value, target, prefix);
      }

      // Ensure all other function properties are bound to the original target
      // so private fields and internal invariants are preserved.
      if (typeof value === "function") {
        return (value as Function).bind(target);
      }

      return value;
    },
  });
}

function hasAllMethods(a: MastraAgentMethods): a is MastraAgentMethods & {
  generate: (params: any) => any;
  stream: (params: any) => any;
} {
  return typeof a.generate === "function" && typeof a.stream === "function";
}

/**
 * Creates a wrapped version of generate with Braintrust tracing
 */
function wrapGenerate(
  original: Function,
  target: MastraAgentMethods,
  prefix: string,
): Function {
  return function (...args: unknown[]) {
    const input = args[0];

    return traced(
      async (span) => {
        const result = await original.apply(target, args);

        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(result?.finishReason);

        // Extract usage metrics if available
        const metrics = result?.usage
          ? normalizeUsageMetrics(
              result.usage,
              provider,
              result.providerMetadata,
            )
          : {};

        span.log({
          input,
          output: result,
          metadata: {
            agent_name: target.name ?? prefix,
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
          metrics,
        });
        return result;
      },
      {
        name: `${prefix}.generate`,
      },
    );
  };
}

/**
 * Creates a wrapped version of stream with Braintrust tracing
 */
function wrapStream(
  original: Function,
  target: MastraAgentMethods,
  prefix: string,
): Function {
  return function (...args: unknown[]) {
    const input = args[0];

    const span = startSpan({
      name: `${prefix}.stream`,
      event: {
        input,
        metadata: {
          agent_name: target.name ?? prefix,
        },
      },
    });

    const baseOpts: any =
      typeof args[1] === "object" && args[1] !== null ? args[1] : {};

    // Warn about non-AI SDK v5 format but allow it to proceed
    if (baseOpts.format && baseOpts.format !== "aisdk" && !aiSDKFormatWarning) {
      aiSDKFormatWarning = true;
      console.warn(
        `Braintrust Mastra wrapper: For best compatibility, use { format: 'aisdk' } (AI SDK v5) instead of format: '${baseOpts.format}'. See https://mastra.ai/en/docs/frameworks/agentic-uis/ai-sdk for more details.`,
      );
    }

    // Use user's format if specified, otherwise default to 'aisdk'
    const wrappedOpts: any = {
      ...baseOpts,
      format: baseOpts.format || "aisdk", // Default to AI SDK v5 format if not specified
    };

    const userOnChunk = baseOpts?.onChunk;
    const userOnFinish = baseOpts?.onFinish;
    const userOnError = baseOpts?.onError;

    const startTime = Date.now();
    let receivedFirst = false;

    wrappedOpts.onChunk = (chunk: unknown) => {
      try {
        userOnChunk?.(chunk);
      } finally {
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: { time_to_first_token: (Date.now() - startTime) / 1000 },
          });
        }
      }
    };

    wrappedOpts.onFinish = async (event: unknown) => {
      try {
        await userOnFinish?.(event);
      } finally {
        const e: any = event;
        const provider = detectProviderFromResult(e);
        const model = extractModelFromResult(e);
        const finishReason = normalizeFinishReason(e?.finishReason);

        // Extract usage metrics if available
        const metrics = e?.usage
          ? normalizeUsageMetrics(e.usage, provider, e.providerMetadata)
          : {};

        span.log({
          output: e.text ?? e.content ?? e,
          metadata: {
            agent_name: target.name ?? prefix,
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
          metrics,
        });
        span.end();
      }
    };

    wrappedOpts.onError = async (err: unknown) => {
      try {
        await userOnError?.(err);
      } finally {
        logError(span, err);
        span.end();
      }
    };

    return withCurrent(span, () =>
      original.apply(target, [args[0], wrappedOpts, ...args.slice(2)]),
    );
  };
}

function detectProviderFromResult(result: {
  providerMetadata?: Record<string, unknown>;
}): string | undefined {
  if (!result?.providerMetadata) {
    return undefined;
  }

  const keys = Object.keys(result.providerMetadata);
  return keys?.at(0);
}

function extractModelFromResult(result: {
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

function normalizeFinishReason(reason: any): string | undefined {
  if (typeof reason !== "string") return undefined;
  return reason.replace(/-/g, "_");
}

function normalizeUsageMetrics(
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

function wrapTools<
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

function getNumberProperty(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) {
    return undefined;
  }
  const value = Reflect.get(obj, key);
  return typeof value === "number" ? value : undefined;
}
