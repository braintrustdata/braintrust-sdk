/* eslint-disable @typescript-eslint/no-explicit-any */

import { traced } from "../../logger";
import { SpanTypeAttribute } from "../../../util";

/**
 * Wraps a language model (V3 or compatible) to add Braintrust tracing to its doGenerate method.
 * This mimics how wrapAISDK works but at the model level.
 *
 * Uses a generic type constraint instead of specific LanguageModel version
 * to ensure compatibility with both current and future AI SDK versions.
 */
function wrapModel<
  T extends { doGenerate: (...args: any[]) => any; provider?: string },
>(model: T, modelId: string): T {
  // Avoid double wrapping
  if ((model as any)._braintrustWrapped) {
    return model;
  }

  const originalDoGenerate = model.doGenerate.bind(model);

  const wrappedDoGenerate = async (
    options: Parameters<typeof originalDoGenerate>[0],
  ) => {
    return await traced(
      async (span) => {
        // Execute the LLM call
        const result = await originalDoGenerate(options);

        // Log output and metrics (mimicking wrapAISDK)
        span.log({
          output: {
            text: result.text,
            finishReason: result.finishReason,
          },
          metrics: {
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage
              ? (result.usage.promptTokens ?? 0) +
                (result.usage.completionTokens ?? 0)
              : undefined,
          },
        });

        return result;
      },
      {
        name: "doGenerate",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: {
            prompt: options.prompt,
            system: options.system,
            messages: options.messages,
          },
          metadata: {
            model: modelId,
            provider: model.provider,
            mode: options.mode,
          },
        },
      },
    );
  };

  // Create a proxy that intercepts doGenerate calls
  const wrappedModel = new Proxy(model, {
    get(target, prop) {
      if (prop === "doGenerate") {
        return wrappedDoGenerate;
      }
      if (prop === "_braintrustWrapped") {
        return true;
      }
      return Reflect.get(target, prop);
    },
  });

  return wrappedModel;
}

/**
 * Wraps an AI SDK provider (ProviderV3) to add Braintrust tracing to all LLM calls.
 *
 * This is useful when you can't use `wrapAISDK` directly (e.g., with Temporal's AI SDK plugin)
 * but still want LLM observability. The wrapper intercepts all model creation and wraps the
 * models' `doGenerate` methods with Braintrust tracing.
 *
 *
 * @example
 * ```typescript
 * import { wrapAISDKProvider } from "braintrust";
 * import { openai } from "@ai-sdk/openai";
 * import { AiSdkPlugin } from "@temporalio/ai-sdk";
 *
 * // Wrap the provider to add tracing
 * const tracedOpenAI = wrapAISDKProvider(openai);
 *
 * // Use with Temporal AI SDK
 * new AiSdkPlugin({
 *   modelProvider: tracedOpenAI,  // Now all LLM calls are traced!
 * })
 * ```
 * @param provider - The AI SDK provider to wrap (e.g., openai, anthropic)
 * @returns A wrapped provider that traces all LLM calls to Braintrust
 */
export function wrapAISDKProvider<T extends Record<string, any>>(
  provider: T,
): T {
  // Use a Proxy to intercept all property accesses
  return new Proxy(provider, {
    get(target, prop) {
      const original = Reflect.get(target, prop);

      // Wrap methods that create language models
      if (prop === "languageModel" && typeof original === "function") {
        return function (modelId: string, ...args: any[]) {
          const model = (original as Function).apply(target, [
            modelId,
            ...args,
          ]);
          return wrapModel(model, modelId);
        };
      }

      // If calling the provider as a function (e.g., openai("gpt-4"))
      if (
        prop === Symbol.for("nodejs.util.inspect.custom") ||
        typeof original === "function"
      ) {
        // For callable providers, wrap the call
        if (typeof target === "function" && prop === "apply") {
          return function (thisArg: any, args: any[]) {
            const model = (target as any).apply(thisArg, args);
            if (model && typeof model === "object" && "doGenerate" in model) {
              return wrapModel(model, args[0] || "unknown");
            }
            return model;
          };
        }
        if (typeof target === "function" && prop === "call") {
          return function (thisArg: any, ...args: any[]) {
            const model = (target as any).call(thisArg, ...args);
            if (model && typeof model === "object" && "doGenerate" in model) {
              return wrapModel(model, args[0] || "unknown");
            }
            return model;
          };
        }
      }

      return original;
    },
    apply(target, thisArg, args) {
      // Handle direct calls: openai("gpt-4")
      const model = (target as any).apply(thisArg, args);
      if (model && typeof model === "object" && "doGenerate" in model) {
        return wrapModel(model, args[0] || "unknown");
      }
      return model;
    },
  });
}
