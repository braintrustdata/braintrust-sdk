import { BraintrustMiddleware } from "./ai-sdk-v2";
import { startSpan, traced, withCurrent } from "../logger";
import { SpanTypeAttribute } from "@braintrust/core";
import {
  extractModelParameters,
  normalizeUsageMetrics,
  detectProviderFromResult,
  buildAssistantOutputFromSteps,
  wrapTools,
  extractModelFromResult,
  normalizeFinishReason,
} from "./ai-sdk-shared";

// Define a neutral interface for the AI SDK methods we use.
// This avoids importing `typeof import("ai")`, which can cause type-identity
// conflicts when multiple copies/versions of `ai` exist in the workspace.
interface AISDKMethods {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wrapLanguageModel: (options: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateText: (params: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamText: (params: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateObject: (params: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  streamObject: (params: any) => any;
}

// V3-specific exclude keys for extractModelParameters
const V3_EXCLUDE_KEYS = new Set([
  "prompt", // Already captured as input
  "system", // Already captured as input
  "messages", // Already captured as input
  "model", // Already captured in metadata.model
  "providerOptions", // Internal AI SDK configuration
  "tools", // Already captured in metadata.tools
]);

/**
 * Wraps Vercel AI SDK methods with Braintrust tracing. Returns wrapped versions
 * of generateText, streamText, generateObject, and streamObject that automatically
 * create spans and log inputs, outputs, and metrics.
 *
 * @param ai - The AI SDK namespace (e.g., import * as ai from "ai")
 * @returns Object with AI SDK methods with Braintrust tracing
 *
 * @example
 * ```typescript
 * import { wrapAISDK } from "braintrust";
 * import * as ai from "ai";
 *
 * const { generateText, streamText, generateObject, streamObject } = wrapAISDK(ai);
 *
 * const result = await generateText({
 *   model: openai("gpt-4"),
 *   prompt: "Hello world"
 * });
 * ```
 */
export function wrapAISDK<T extends AISDKMethods>(
  ai: T,
): {
  generateText: T["generateText"];
  streamText: T["streamText"];
  generateObject: T["generateObject"];
  streamObject: T["streamObject"];
} {
  const {
    wrapLanguageModel,
    generateText,
    streamText,
    generateObject,
    streamObject,
  } = ai;
  const wrappedGenerateText = (params: any) => {
    return traced(
      async (span) => {
        const wrappedModel = wrapModel(wrapLanguageModel, params.model);

        const result = await generateText({
          ...(params as any),
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
        });

        const steps = result.steps;
        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(result?.finishReason);

        span.log({
          input: params.prompt ?? params.messages ?? params.system,
          output: buildAssistantOutputFromSteps(result, steps),
          metadata: {
            ...sharedMetadata(params),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
          metrics: normalizeUsageMetrics(
            result.usage,
            provider,
            result.providerMetadata,
          ),
        });

        return result;
      },
      {
        name: "ai-sdk.generateText",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  const wrappedGenerateObject = (params: any) => {
    return traced(
      async (span) => {
        const wrappedModel = wrapModel(wrapLanguageModel, params.model);

        const result = await generateObject({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
        });

        const provider = detectProviderFromResult(result);
        const model = extractModelFromResult(result);
        const finishReason = normalizeFinishReason(
          (result as any)?.finishReason,
        );

        span.log({
          input: params.prompt ?? params.messages ?? params.system,
          output: result.object,
          metadata: {
            ...sharedMetadata(params),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(finishReason ? { finish_reason: finishReason } : {}),
          },
          metrics: normalizeUsageMetrics(
            (result as any)?.usage,
            provider,
            (result as any)?.providerMetadata,
          ),
        });

        return result;
      },
      {
        name: "ai-sdk.generateObject",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  const wrappedStreamText = (params: any) => {
    const span = startSpan({
      name: "ai-sdk.streamText",
      spanAttributes: { type: SpanTypeAttribute.LLM },
      event: {
        input: params.prompt ?? params.messages ?? params.system,
        metadata: sharedMetadata(params),
      },
    });

    const userOnFinish = params.onFinish;
    const userOnError = params.onError;
    const userOnChunk = params.onChunk;

    try {
      const wrappedModel = wrapModel(wrapLanguageModel, params.model);

      const tfft = Date.now();
      let receivedFirstToken = false;
      const result = withCurrent(span, () =>
        streamText({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
          onChunk: (chunk: any) => {
            if (!receivedFirstToken) {
              receivedFirstToken = true;
              span.log({
                metrics: { time_to_first_token: (Date.now() - tfft) / 1000 },
              });
            }

            if (typeof userOnChunk === "function") {
              userOnChunk(chunk);
            }
          },
          onFinish: async (event: any) => {
            if (typeof userOnFinish === "function") {
              await userOnFinish(event);
            }
            const provider = detectProviderFromResult(event);
            const model = extractModelFromResult(event);
            const finishReason = normalizeFinishReason(event?.finishReason);
            span.log({
              output: event?.text,
              metadata: {
                ...sharedMetadata(params),
                ...(provider ? { provider } : {}),
                ...(model ? { model } : {}),
                ...(finishReason ? { finish_reason: finishReason } : {}),
              },
              metrics: normalizeUsageMetrics(
                event?.usage,
                provider,
                event?.providerMetadata,
              ),
            });
            span.end();
          },
          onError: async (err: unknown) => {
            if (typeof userOnError === "function") {
              await userOnError(err);
            }
            span.log({
              error: err instanceof Error ? err.message : String(err),
            });
            span.end();
          },
        }),
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

  const wrappedStreamObject = (params: any) => {
    const span = startSpan({
      name: "ai-sdk.streamObject",
      spanAttributes: { type: SpanTypeAttribute.LLM },
      event: {
        input: params.prompt ?? params.messages ?? params.system,
        metadata: sharedMetadata(params),
      },
    });

    const userOnFinish = params.onFinish;
    const userOnError = params.onError;
    const userOnChunk = params.onChunk;

    try {
      const wrappedModel = wrapModel(wrapLanguageModel, params.model);

      const tfft = Date.now();
      let receivedFirstToken = false;
      const result = withCurrent(span, () =>
        streamObject({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
          onChunk: (chunk: any) => {
            if (!receivedFirstToken) {
              receivedFirstToken = true;
              span.log({
                metrics: { time_to_first_token: (Date.now() - tfft) / 1000 },
              });
            }

            if (typeof userOnChunk === "function") {
              userOnChunk(chunk);
            }
          },
          onFinish: async (event: any) => {
            if (typeof userOnFinish === "function") {
              await userOnFinish(event);
            }
            const provider = detectProviderFromResult(event);
            const model = extractModelFromResult(event);
            const finishReason = normalizeFinishReason(event?.finishReason);
            span.log({
              output: event?.object,
              metadata: {
                ...sharedMetadata(params),
                ...(provider ? { provider } : {}),
                ...(model ? { model } : {}),
                ...(finishReason ? { finish_reason: finishReason } : {}),
              },
              metrics: normalizeUsageMetrics(
                event?.usage,
                provider,
                event?.providerMetadata,
              ),
            });
            span.end();
          },
          onError: async (err: unknown) => {
            if (typeof userOnError === "function") {
              await userOnError(err);
            }
            span.log({
              error: err instanceof Error ? err.message : String(err),
            });
            span.end();
          },
        }),
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

  return {
    generateText: wrappedGenerateText as T["generateText"],
    generateObject: wrappedGenerateObject as T["generateObject"],
    streamText: wrappedStreamText as T["streamText"],
    streamObject: wrappedStreamObject as T["streamObject"],
  };
}

function wrapModel(
  wrapLanguageModel: AISDKMethods["wrapLanguageModel"],
  model: unknown,
) {
  return wrapLanguageModel({
    model,
    middleware: BraintrustMiddleware(),
  });
}

function sharedMetadata(params: any) {
  return {
    ...extractModelParameters(params, V3_EXCLUDE_KEYS),
  } as Record<string, unknown>;
}
