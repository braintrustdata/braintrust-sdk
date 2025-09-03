import { BraintrustMiddleware } from "./ai-sdk-v2";
import { wrapTraced, traced } from "../logger";
import { SpanTypeAttribute } from "@braintrust/core";
import {
  extractModelParameters,
  normalizeUsageMetrics,
  detectProviderFromResult,
  extractModelFromResult,
} from "./ai-sdk-shared";

// V3-specific exclude keys for extractModelParameters
const V3_EXCLUDE_KEYS = new Set([
  "prompt", // Already captured as input
  "system", // Already captured as input
  "messages", // Already captured as input
  "model", // Already captured in metadata.model
  "providerOptions", // Internal AI SDK configuration
  "tools", // Already captured in metadata.tools
]);

const _logTracedSpan = (
  span: any,
  params: Record<string, unknown>,
  result: any,
) => {
  const provider = detectProviderFromResult(result);

  span.log({
    input: params.prompt,
    output: result.content,
    metadata: {
      ...extractModelParameters(params, V3_EXCLUDE_KEYS),
    },
    metrics: normalizeUsageMetrics(
      result.usage,
      provider,
      result.providerMetadata,
    ),
  });
};

const _wrapTools = (tools?: Record<string, unknown>) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedTools: Record<string, any> = {};
  if (tools) {
    for (const [key, tool] of Object.entries(tools)) {
      wrappedTools[key] = tool;
      if (
        tool != null &&
        typeof tool === "object" &&
        "execute" in tool &&
        typeof tool.execute === "function"
      ) {
        wrappedTools[key].execute = wrapTraced(tool.execute.bind(tool), {
          name: key,
          type: "tool",
        });
      }
    }
  }
  return wrappedTools;
};

/**
 * Wrap AI SDK v3 functions to add Braintrust tracing. Returns wrapped versions
 * of generateText, streamText, generateObject, and streamObject that automatically
 * create spans and log inputs, outputs, and metrics.
 *
 * @param ai - The AI SDK namespace (e.g., import * as ai from "ai")
 * @returns Object with wrapped functions
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
const wrapAISDK = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  WrapLanguageModelType extends (...args: any[]) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GenerateTextType extends (...args: any[]) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  StreamTextType extends (...args: any[]) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  StreamObjectType extends (...args: any[]) => any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GenerateObjectType extends (...args: any[]) => any,
>({
  wrapLanguageModel,
  generateText,
  streamText,
  streamObject,
  generateObject,
}: {
  wrapLanguageModel: WrapLanguageModelType;
  generateText: GenerateTextType;
  streamText: StreamTextType;
  streamObject: StreamObjectType;
  generateObject: GenerateObjectType;
}) => {
  const wrappedGenerateText = async (
    params: Parameters<GenerateTextType>[0],
  ) => {
    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware(),
        });

        const result = (await generateText({
          ...params,
          tools: _wrapTools(params.tools),
          model: wrappedModel,
        })) as ReturnType<GenerateTextType>;

        _logTracedSpan(span, params, result);

        return result;
      },
      {
        name: "ai-sdk.generateText",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  const wrappedGenerateObject = async (
    params: Parameters<GenerateObjectType>[0],
  ) => {
    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware(),
        });

        const result = (await generateObject({
          ...params,
          model: wrappedModel,
        })) as ReturnType<GenerateObjectType>;

        _logTracedSpan(span, params, result);

        return result;
      },
      {
        name: "ai-sdk.generateObject",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  const wrappedStreamText = async (params: Parameters<StreamTextType>[0]) => {
    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware(),
        });

        const result = (await streamText({
          ...params,
          tools: _wrapTools(params.tools),
          model: wrappedModel,
        })) as ReturnType<StreamTextType>;

        _logTracedSpan(span, params, result);

        return result;
      },
      {
        name: "ai-sdk.streamText",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  const wrappedStreamObject = async (
    params: Parameters<StreamObjectType>[0],
  ) => {
    return traced(
      async (span) => {
        const wrappedModel = wrapLanguageModel({
          model: params.model,
          middleware: BraintrustMiddleware(),
        });

        const result = (await streamObject({
          ...params,
          model: wrappedModel,
        })) as ReturnType<StreamObjectType>;

        _logTracedSpan(span, params, result);

        return result;
      },
      {
        name: "ai-sdk.streamObject",
        spanAttributes: { type: SpanTypeAttribute.LLM },
      },
    );
  };

  return {
    generateText: wrappedGenerateText,
    generateObject: wrappedGenerateObject,
    streamText: wrappedStreamText,
    streamObject: wrappedStreamObject,
  };
};

export { wrapAISDK };
