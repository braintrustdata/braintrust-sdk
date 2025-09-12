import { startSpan, traced, withCurrent, logError } from "../logger";
import {
  detectProviderFromResult,
  extractModelFromResult,
  normalizeFinishReason,
  normalizeUsageMetrics,
  wrapTools,
} from "./ai-sdk-shared";
import { wrapLanguageModel } from "ai";
import { BraintrustMiddleware } from "./ai-sdk-v2";

type AnyFunc = (...args: any[]) => any;
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
  generateVNext?: AnyFunc;
  streamVNext?: AnyFunc;
}

function hasAllMethods(a: MastraAgentMethods): a is MastraAgentMethods & {
  generateVNext: AnyFunc;
  streamVNext: AnyFunc;
} {
  return (
    typeof a.generateVNext === "function" && typeof a.streamVNext === "function"
  );
}

/**
 * Wraps a Mastra agent with Braintrust tracing. This function wraps the agent's
 * underlying language model with BraintrustMiddleware and traces all agent method calls.
 *
 * **Important**: This wrapper only supports AI SDK v5 methods such as `generateVNext` and `streamVNext`.
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

  // Guard upfront that all methods exist, then override
  if (!hasAllMethods(agent)) {
    return agent;
  }

  const _originalGenerateVNext = agent.generateVNext.bind(agent);
  const _originalStreamVNext = agent.streamVNext.bind(agent);

  agent.model = wrapLanguageModel({
    model: agent.model,
    middleware: BraintrustMiddleware(),
  });
  if (agent.tools) {
    agent.__setTools(wrapTools(agent.tools));
  }

  // generateVNext (explicit override with _original style)
  agent.generateVNext = function (...args: unknown[]) {
    const input = args[0];

    return traced(
      async (span) => {
        const result = await _originalGenerateVNext.call(agent, ...args);

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
          output: result.text ?? result.content ?? result,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
          metrics,
        });
        return result;
      },
      {
        name: `${prefix}.generateVNext`,
      },
    );
  };

  // streamVNext (explicit override with hooks) - AI SDK v5 compatible
  agent.streamVNext = function (...args: unknown[]) {
    const input = args[0];

    const span = startSpan({
      name: `${prefix}.streamVNext`,
      event: {
        input,
        metadata: {
          agent_name: agent.name ?? prefix,
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
    const wrappedOpts = {
      ...baseOpts,
      format: baseOpts.format || "aisdk", // Default to AI SDK v5 format if not specified
    };

    const userOnChunk = baseOpts?.onChunk;
    const userOnFinish = baseOpts?.onFinish;
    const userOnError = baseOpts?.onError;

    const startTime = Date.now();
    let receivedFirst = false;

    wrappedOpts.onChunk = (chunk: unknown) => {
      userOnChunk?.(chunk);
      if (!receivedFirst) {
        receivedFirst = true;
        span.log({
          metrics: { time_to_first_token: (Date.now() - startTime) / 1000 },
        });
      }
    };

    wrappedOpts.onFinish = async (event: unknown) => {
      await userOnFinish?.(event);

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
          agent_name: agent.name ?? prefix,
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          ...(finishReason ? { finish_reason: finishReason } : {}),
        },
        metrics,
      });
      span.end();
    };

    wrappedOpts.onError = async (err: unknown) => {
      logError(span, err);
      span.end();
      await userOnError?.(err);
    };

    const result = withCurrent(span, () =>
      _originalStreamVNext.call(agent, args[0], wrappedOpts, ...args.slice(2)),
    );

    return result;
  };

  return agent;
}
