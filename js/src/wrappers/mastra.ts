import { startSpan, traced, withCurrent } from "../logger";
import {
  detectProviderFromResult,
  extractModelFromResult,
  extractModelParameters,
  extractInput,
  normalizeFinishReason,
  normalizeUsageMetrics,
} from "./ai-sdk-shared";
import { SpanTypeAttribute } from "../../util/index";
import { wrapLanguageModel } from "ai";
import { BraintrustMiddleware } from "./ai-sdk-v2";

/*
MastraAgentMethods is a neutral interface for the Mastra agent methods we use.
This avoids importing `typeof import("mastra")`, which can cause type-identity
conflicts when multiple copies/versions of `mastra` exist in the workspace.
*/
type AnyFunc = (...args: any[]) => any;

interface MastraAgentMethods {
  name?: string;
  tools?: Record<string, unknown> | unknown[];
  model?: any; // The language model used by the agent
  generate?: AnyFunc;
  generateVNext?: AnyFunc;
  stream?: AnyFunc;
  streamVNext?: AnyFunc;
}

function hasAllMethods(a: MastraAgentMethods): a is MastraAgentMethods & {
  generate: AnyFunc;
  generateVNext: AnyFunc;
  stream: AnyFunc;
  streamVNext: AnyFunc;
} {
  return (
    typeof a.generate === "function" &&
    typeof a.generateVNext === "function" &&
    typeof a.stream === "function" &&
    typeof a.streamVNext === "function"
  );
}

// Mastra-specific exclude keys for extractModelParameters
const MASTRA_EXCLUDE_KEYS = new Set([
  "prompt", // Already captured as input
  "system", // Already captured as input
  "messages", // Already captured as input
  "model", // Already captured in metadata.model
  "providerOptions", // Internal configuration
  "tools", // Already captured in metadata.tools
]);

/**
 * Wraps a Mastra agent with Braintrust tracing. This function wraps the agent's
 * underlying language model with BraintrustMiddleware and traces all agent method calls.
 *
 * **Important**: This wrapper recommends AI SDK v5 format for streaming methods.
 * For `stream()` and `streamVNext()` calls, the wrapper defaults to `format: 'aisdk'`
 * and will warn if you specify a different format (but will still allow it).
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
  const prefix =
    options?.name ?? options?.span_name ?? agent.name ?? "mastraAgent";

  // Guard upfront that all methods exist, then override
  if (!hasAllMethods(agent)) {
    return agent;
  }

  // Wrap the agent's model with BraintrustMiddleware if it exists
  let wrappedModel: any = agent.model;
  if (agent.model) {
    try {
      wrappedModel = wrapLanguageModel({
        model: agent.model,
        middleware: BraintrustMiddleware(),
      });
    } catch (error) {
      // If wrapping fails, use the original model
      console.warn("Failed to wrap Mastra agent model:", error);
      wrappedModel = agent.model;
    }
  }

  const _originalGenerate = agent.generate.bind(agent);
  const _originalGenerateVNext = agent.generateVNext.bind(agent);
  const _originalStream = agent.stream.bind(agent);
  const _originalStreamVNext = agent.streamVNext.bind(agent);

  // generate (explicit override with _original style)
  agent.generate = function (...args: unknown[]) {
    const params = Array.isArray(args) && args.length > 0 ? args[0] : {};
    const input = extractInput(params);

    return traced(
      async (span) => {
        // Create a new agent instance with the wrapped model for this call
        const tempAgent = { ...agent, model: wrappedModel };
        const result: any = await _originalGenerate.call(tempAgent, ...args);

        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(result?.finishReason);
        const output = result?.text ?? result?.message ?? result;

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
          output,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...extractModelParameters(params as any, MASTRA_EXCLUDE_KEYS),
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
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  // generateVNext (explicit override with _original style)
  agent.generateVNext = function (...args: unknown[]) {
    const params = Array.isArray(args) && args.length > 0 ? args[0] : {};
    const input = extractInput(params);

    return traced(
      async (span) => {
        // Create a new agent instance with the wrapped model for this call
        const tempAgent = { ...agent, model: wrappedModel };
        const result: any = await _originalGenerateVNext.call(
          tempAgent,
          ...args,
        );

        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(result?.finishReason);
        const output = result?.text ?? result?.message ?? result;

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
          output,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...extractModelParameters(params as any, MASTRA_EXCLUDE_KEYS),
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
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  // stream (explicit override with hooks)
  agent.stream = function (...args: unknown[]) {
    const params = Array.isArray(args) && args.length > 0 ? args[0] : {};
    const input = extractInput(params);

    const span = startSpan({
      name: `${prefix}.stream`,
      spanAttributes: { type: SpanTypeAttribute.LLM },
      event: {
        input,
        metadata: {
          agent_name: agent.name ?? prefix,
          ...extractModelParameters(params as any, MASTRA_EXCLUDE_KEYS),
        },
      },
    });

    const baseOpts: any =
      typeof args[1] === "object" && args[1] !== null ? args[1] : {};

    // Warn about non-AI SDK v5 format but allow it to proceed
    if (baseOpts.format && baseOpts.format !== "aisdk") {
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

    try {
      const startTime = Date.now();
      let receivedFirst = false;

      // Add our tracking hooks
      wrappedOpts.onChunk = (chunk: unknown) => {
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: { time_to_first_token: (Date.now() - startTime) / 1000 },
          });
        }
        if (typeof userOnChunk === "function") {
          userOnChunk(chunk);
        }
      };

      wrappedOpts.onFinish = async (event: unknown) => {
        if (typeof userOnFinish === "function") {
          await userOnFinish(event);
        }
        const e: any = event;
        const provider = detectProviderFromResult(e);
        const model = extractModelFromResult(e);
        const finishReason = normalizeFinishReason(e?.finishReason);
        const output = e?.text ?? e;

        // Extract usage metrics if available
        const metrics = e?.usage
          ? normalizeUsageMetrics(e.usage, provider, e.providerMetadata)
          : {};

        span.log({
          output,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...extractModelParameters(params as any, MASTRA_EXCLUDE_KEYS),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
          metrics,
        });
        span.end();
      };

      wrappedOpts.onError = async (err: unknown) => {
        if (typeof userOnError === "function") {
          await userOnError(err);
        }
        span.log({ error: err instanceof Error ? err.message : String(err) });
        span.end();
      };

      // Create a new agent instance with the wrapped model for this call
      const tempAgent = { ...agent, model: wrappedModel };
      const result = withCurrent(span, () =>
        _originalStream.call(tempAgent, args[0], wrappedOpts, ...args.slice(2)),
      );

      return result;
    } catch (error) {
      span.log({
        error: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  };

  // streamVNext (explicit override with hooks) - AI SDK v5 compatible
  agent.streamVNext = function (...args: unknown[]) {
    const params = Array.isArray(args) && args.length > 0 ? args[0] : {};
    const input = extractInput(params);

    const span = startSpan({
      name: `${prefix}.streamVNext`,
      spanAttributes: { type: SpanTypeAttribute.LLM },
      event: {
        input,
        metadata: {
          agent_name: agent.name ?? prefix,
          ...extractModelParameters(params as any, MASTRA_EXCLUDE_KEYS),
        },
      },
    });

    const baseOpts: any =
      typeof args[1] === "object" && args[1] !== null ? args[1] : {};

    // Warn about non-AI SDK v5 format but allow it to proceed
    if (baseOpts.format && baseOpts.format !== "aisdk") {
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

    try {
      const startTime = Date.now();
      let receivedFirst = false;

      // Add our tracking hooks
      wrappedOpts.onChunk = (chunk: unknown) => {
        if (!receivedFirst) {
          receivedFirst = true;
          span.log({
            metrics: { time_to_first_token: (Date.now() - startTime) / 1000 },
          });
        }
        if (typeof userOnChunk === "function") {
          userOnChunk(chunk);
        }
      };

      wrappedOpts.onFinish = async (event: unknown) => {
        if (typeof userOnFinish === "function") {
          await userOnFinish(event);
        }
        const e: any = event;
        const provider = detectProviderFromResult(e);
        const model = extractModelFromResult(e);
        const finishReason = normalizeFinishReason(e?.finishReason);
        const output = e?.text ?? e;

        // Extract usage metrics if available
        const metrics = e?.usage
          ? normalizeUsageMetrics(e.usage, provider, e.providerMetadata)
          : {};

        span.log({
          output,
          metadata: {
            agent_name: agent.name ?? prefix,
            ...extractModelParameters(params as any, MASTRA_EXCLUDE_KEYS),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
          metrics,
        });
        span.end();
      };

      wrappedOpts.onError = async (err: unknown) => {
        if (typeof userOnError === "function") {
          await userOnError(err);
        }
        span.log({ error: err instanceof Error ? err.message : String(err) });
        span.end();
      };

      // Create a new agent instance with the wrapped model for this call
      const tempAgent = { ...agent, model: wrappedModel };
      const result = withCurrent(span, () =>
        _originalStreamVNext.call(
          tempAgent,
          args[0],
          wrappedOpts,
          ...args.slice(2),
        ),
      );

      return result;
    } catch (error) {
      span.log({
        error: error instanceof Error ? error.message : String(error),
      });
      span.end();
      throw error;
    }
  };

  return agent;
}
