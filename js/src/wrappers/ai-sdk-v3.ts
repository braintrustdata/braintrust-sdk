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

// Define a neutral interface for the subset of AI SDK methods we use.
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

function isAISDKMethods(obj: unknown): obj is AISDKMethods {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.wrapLanguageModel === "function" &&
    typeof o.generateText === "function" &&
    typeof o.streamText === "function" &&
    typeof o.generateObject === "function" &&
    typeof o.streamObject === "function"
  );
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
  if (!isAISDKMethods(ai)) {
    throw new Error(
      'wrapAISDK expected a Vercel AI SDK namespace (e.g., `import * as ai from "ai"`). Missing required methods.',
    );
  }

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
        const wrappedModel = wrapModel(
          wrapLanguageModel,
          params.model,
          "generate",
        );

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
        const wrappedModel = wrapModel(
          wrapLanguageModel,
          params.model,
          "generate",
        );

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

    try {
      const result = withCurrent(span, () => {
        const wrappedModel = wrapModel(
          wrapLanguageModel,
          params.model,
          "stream",
        );

        return streamText({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
        });
      });

      const wrappedTextStream = _wrapAsyncIterable(
        result.textStream,
        (deltaMs) => span.log({ metrics: { time_to_first_token: deltaMs } }),
        () => span.end(),
      );

      span.log({ output: wrappedTextStream });

      return { ...result, textStream: wrappedTextStream };
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

    try {
      const result = withCurrent(span, () => {
        const wrappedModel = wrapModel(
          wrapLanguageModel,
          params.model,
          "stream",
        );

        return streamObject({
          ...params,
          tools: params.tools ? wrapTools(params.tools) : undefined,
          model: wrappedModel,
        });
      });

      const stream = (result as any).partialObjectStream as
        | AsyncIterable<unknown>
        | undefined;

      if (stream && Symbol.asyncIterator in stream) {
        const wrapped = _wrapAsyncIterable(
          stream,
          (deltaMs) => span.log({ metrics: { time_to_first_token: deltaMs } }),
          () => span.end(),
        );
        span.log({ output: wrapped });
        return { ...result, partialObjectStream: wrapped } as any;
      } else {
        // Fallback: no partial stream available
        span.log({ output: (result as any).object });
        span.end();
        return result;
      }
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
  kind: "generate" | "stream",
) {
  return wrapLanguageModel({
    model,
    middleware: BraintrustMiddleware({
      name: kind === "generate" ? "ai-sdk.doGenerate" : "ai-sdk.doStream",
    }),
  });
}

function sharedMetadata(params: any) {
  return {
    ...extractModelParameters(params, V3_EXCLUDE_KEYS),
  } as Record<string, unknown>;
}

// Wrap an AsyncIterable to compute time_to_first_token and end span on completion
async function* _wrapAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  onFirst: (deltaMs: number) => void,
  onDone: () => void,
) {
  const start = Date.now();
  let first = true;
  try {
    for await (const chunk of iterable) {
      if (first) {
        first = false;
        onFirst(Date.now() - start);
      }
      yield chunk;
    }
  } finally {
    onDone();
  }
}
