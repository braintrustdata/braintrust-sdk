import { BraintrustMiddleware } from "./ai-sdk-v2";
import { traced } from "../logger";
import { SpanTypeAttribute } from "@braintrust/core";
import {
  extractModelParameters,
  normalizeUsageMetrics,
  detectProviderFromResult,
  buildAssistantOutputFromSteps,
  wrapTools,
} from "./ai-sdk-shared";

type AISDKV3 = typeof import("ai");

type AISDKV3Methods = Pick<
  AISDKV3,
  | "wrapLanguageModel"
  | "generateText"
  | "streamText"
  | "generateObject"
  | "streamObject"
>;

type GenerateText = AISDKV3Methods["generateText"];
type StreamText = AISDKV3Methods["streamText"];
type GenerateObject = AISDKV3Methods["generateObject"];
type StreamObject = AISDKV3Methods["streamObject"];

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
export function wrapAISDK({
  wrapLanguageModel,
  generateText,
  streamText,
  generateObject,
  streamObject,
}: AISDKV3Methods) {
  const wrappedGenerateText = ((params: Parameters<GenerateText>[0]) => {
    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware({ name: "ai-sdk.doGenerate" }),
        });

        const result = await generateText({
          ...(params as any),
          tools: wrapTools(params.tools),
          model: wrappedModel,
        } as Parameters<GenerateText>[0]);

        const steps = result.steps;
        const provider = detectProviderFromResult(result);

        span.log({
          input: params.prompt,
          output: buildAssistantOutputFromSteps(result, steps),
          metadata: {
            ...extractModelParameters(params, V3_EXCLUDE_KEYS),
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
  }) as GenerateText;

  const wrappedGenerateObject = ((params: Parameters<GenerateObject>[0]) => {
    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware({ name: "ai-sdk.doGenerate" }),
        });

        const result = await generateObject({
          ...params,
          model: wrappedModel,
        } as Parameters<GenerateObject>[0]);

        span.log({
          input: params.prompt,
          output: result.object,
          metadata: {
            ...extractModelParameters(params, V3_EXCLUDE_KEYS),
          },
        });

        return result;
      },
      {
        name: "ai-sdk.generateObject",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  }) as GenerateObject;

  const wrappedStreamText = ((params: Parameters<StreamText>[0]) => {
    return traced(
      (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware({ name: "ai-sdk.doStream" }),
        });

        const result = streamText({
          ...params,
          tools: wrapTools(params.tools),
          model: wrappedModel,
        } as Parameters<StreamText>[0]);

        span.log({
          input: params.prompt,
          output: result.textStream,
          metadata: {
            ...extractModelParameters(params, V3_EXCLUDE_KEYS),
          },
        });

        return result;
      },
      {
        name: "ai-sdk.streamText",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  }) as StreamText;

  const wrappedStreamObject = ((params: Parameters<StreamObject>[0]) => {
    return traced(
      (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware({ name: "ai-sdk.doStream" }),
        });

        const result = streamObject({
          ...params,
          model: wrappedModel,
        } as Parameters<StreamObject>[0]);

        span.log({
          input: params.prompt,
          output: result.object,
          metadata: {
            ...extractModelParameters(params, V3_EXCLUDE_KEYS),
          },
        });

        return result;
      },
      {
        name: "ai-sdk.streamObject",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  }) as StreamObject;

  return {
    generateText: wrappedGenerateText,
    generateObject: wrappedGenerateObject,
    streamText: wrappedStreamText,
    streamObject: wrappedStreamObject,
  };
}
