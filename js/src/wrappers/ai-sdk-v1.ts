import {
  ChatCompletionContentPart as ContentPartSchema,
  type ChatCompletionContentPartType as ContentPart,
  ChatCompletionMessageParam as MessageSchema,
  type ChatCompletionMessageParamType as Message,
  ChatCompletionTool as ChatCompletionToolSchema,
  type ChatCompletionToolType as ChatCompletionTool,
} from "../generated_types";
import { startSpan } from "../logger";
import { getCurrentUnixTimestamp, isEmpty } from "../util";
import {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1FinishReason,
  LanguageModelV1FunctionTool,
  LanguageModelV1FunctionToolCall,
  LanguageModelV1ObjectGenerationMode,
  LanguageModelV1Prompt,
  LanguageModelV1ProviderDefinedTool,
  LanguageModelV1StreamPart,
  LanguageModelV1TextPart,
  LanguageModelV1ToolCallPart,
} from "@ai-sdk/provider";
import {
  LEGACY_CACHED_HEADER,
  parseCachedHeader,
  X_CACHED_HEADER,
} from "./oai";

/**
 * Wrap an ai-sdk model (created with `.chat()`, `.completion()`, etc.) to add tracing. If Braintrust is
 * not configured, this is a no-op
 *
 * @param model
 * @returns The wrapped object.
 */
export function wrapAISDKModel<T extends object>(model: T): T {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
  const m = model as any;
  if (
    m?.specificationVersion === "v1" &&
    typeof m?.provider === "string" &&
    typeof m?.modelId === "string"
  ) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    return new BraintrustLanguageModelWrapper(m as LanguageModelV1) as any as T;
  } else {
    console.warn("Unsupported AI SDK model. Not wrapping.");
    return model;
  }
}

class BraintrustLanguageModelWrapper implements LanguageModelV1 {
  constructor(private model: LanguageModelV1) {}

  get specificationVersion() {
    return this.model.specificationVersion;
  }

  get provider(): string {
    return this.model.provider;
  }

  get modelId(): string {
    return this.model.modelId;
  }

  get defaultObjectGenerationMode(): LanguageModelV1ObjectGenerationMode {
    return this.model.defaultObjectGenerationMode;
  }

  get supportsImageUrls(): boolean | undefined {
    return this.model.supportsImageUrls;
  }

  get supportsStructuredOutputs(): boolean | undefined {
    return this.model.supportsStructuredOutputs;
  }

  supportsUrl(url: URL): boolean {
    return this.model.supportsUrl?.(url) ?? false;
  }

  // For the first cut, do not support custom span_info arguments. We can
  // propagate those via async local storage
  async doGenerate(options: LanguageModelV1CallOptions) {
    const span = startSpan({
      name: "Chat Completion",
      spanAttributes: {
        type: "llm",
      },
    });
    const { prompt, mode, ...rest } = options;
    const startTime = getCurrentUnixTimestamp();

    try {
      const ret = await this.model.doGenerate(options);
      span.log({
        input: postProcessPrompt(prompt),
        metadata: {
          model: this.modelId,
          ...rest,
          ...("tools" in mode && mode.tools
            ? { tools: convertTools(mode.tools) }
            : "tool" in mode && mode.tool
              ? { tools: convertTools([mode.tool]) }
              : {}),
        },
        output: postProcessOutput(ret.text, ret.toolCalls, ret.finishReason),
        metrics: {
          time_to_first_token: getCurrentUnixTimestamp() - startTime,
          tokens: !isEmpty(ret.usage)
            ? ret.usage.promptTokens + ret.usage.completionTokens
            : undefined,
          prompt_tokens: ret.usage?.promptTokens,
          completion_tokens: ret.usage?.completionTokens,
          cached: parseCachedHeader(
            ret.rawResponse?.headers?.[X_CACHED_HEADER] ??
              ret.rawResponse?.headers?.[LEGACY_CACHED_HEADER],
          ),
        },
      });
      return ret;
    } finally {
      span.end();
    }
  }

  async doStream(options: LanguageModelV1CallOptions) {
    const { prompt, mode, ...rest } = options;
    const startTime = getCurrentUnixTimestamp();

    const span = startSpan({
      name: "Chat Completion",
      spanAttributes: {
        type: "llm",
      },
    });

    span.log({
      input: postProcessPrompt(prompt),
      metadata: {
        model: this.modelId,
        ...rest,
        ...("tools" in mode && mode.tools
          ? { tools: convertTools(mode.tools) }
          : "tool" in mode && mode.tool
            ? { tools: convertTools([mode.tool]) }
            : {}),
      },
    });

    let ended = false;
    const end = () => {
      if (!ended) {
        span.end();
        ended = true;
      }
    };

    try {
      const ret = await this.model.doStream(options);

      let time_to_first_token: number | undefined = undefined;
      let usage:
        | {
            promptTokens: number;
            completionTokens: number;
          }
        | undefined = undefined;
      let fullText: string | undefined = undefined;
      const toolCalls: Record<string, LanguageModelV1FunctionToolCall> = {};
      let finishReason: LanguageModelV1FinishReason | undefined = undefined;
      return {
        ...ret,
        stream: ret.stream.pipeThrough(
          new TransformStream<
            LanguageModelV1StreamPart,
            LanguageModelV1StreamPart
          >({
            transform(chunk, controller) {
              if (time_to_first_token === undefined) {
                time_to_first_token = getCurrentUnixTimestamp() - startTime;
                span.log({ metrics: { time_to_first_token } });
              }
              switch (chunk.type) {
                case "text-delta":
                  if (fullText === undefined) {
                    fullText = "";
                  }
                  fullText += chunk.textDelta;
                  break;
                case "tool-call":
                  toolCalls[chunk.toolCallId] = {
                    toolCallType: chunk.toolCallType,
                    toolCallId: chunk.toolCallId,
                    toolName: chunk.toolName,
                    args: chunk.args,
                  };
                  break;
                case "tool-call-delta":
                  if (toolCalls[chunk.toolCallId] === undefined) {
                    toolCalls[chunk.toolCallId] = {
                      toolCallType: chunk.toolCallType,
                      toolCallId: chunk.toolCallId,
                      toolName: chunk.toolName,
                      args: "",
                    };
                  }
                  toolCalls[chunk.toolCallId].args += chunk.argsTextDelta;
                  break;
                case "finish":
                  usage = chunk.usage;
                  finishReason = chunk.finishReason;
                  break;
              }

              controller.enqueue(chunk);
            },
            async flush(controller) {
              span.log({
                output: postProcessOutput(
                  fullText,
                  Object.keys(toolCalls).length > 0
                    ? Object.values(toolCalls)
                    : undefined,
                  finishReason!,
                ),
                metrics: {
                  time_to_first_token,
                  tokens: !isEmpty(usage)
                    ? usage.promptTokens + usage.completionTokens
                    : undefined,
                  prompt_tokens: usage?.promptTokens,
                  completion_tokens: usage?.completionTokens,
                  cached: parseCachedHeader(
                    ret.rawResponse?.headers?.[X_CACHED_HEADER] ??
                      ret.rawResponse?.headers?.[LEGACY_CACHED_HEADER],
                  ),
                },
              });
              end();
              controller.terminate();
            },
          }),
        ),
      };
    } finally {
      end();
    }
  }
}

function convertTools(
  tools: Array<
    LanguageModelV1FunctionTool | LanguageModelV1ProviderDefinedTool
  >,
): ChatCompletionTool[] {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return tools.map((tool) => {
    const { type: _, ...rest } = tool;
    return {
      type: tool.type,
      function: rest,
    };
  }) as ChatCompletionTool[];
}

export function postProcessPrompt(prompt: LanguageModelV1Prompt): Message[] {
  return prompt.flatMap((message): Message[] => {
    switch (message.role) {
      case "system":
        return [
          {
            role: "system",
            content: message.content,
          },
        ];
      case "assistant":
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const textPart = message.content.find(
          (part) => part.type === "text",
        ) as LanguageModelV1TextPart | undefined;
        const toolCallParts =
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          message.content.filter(
            (part) => part.type === "tool-call",
          ) as LanguageModelV1ToolCallPart[];
        return [
          {
            role: "assistant",
            content: textPart?.text,
            ...(toolCallParts.length > 0
              ? {
                  tool_calls: toolCallParts.map((part) => ({
                    id: part.toolCallId,
                    function: {
                      name: part.toolName,
                      arguments: JSON.stringify(part.args),
                    },
                    type: "function" as const,
                  })),
                }
              : {}),
          },
        ];
      case "user":
        return [
          {
            role: "user",
            content: message.content.map((part): ContentPart => {
              switch (part.type) {
                case "text":
                  return {
                    type: "text",
                    text: part.text,
                    ...(part.providerMetadata
                      ? { providerMetadata: part.providerMetadata }
                      : {}),
                  };
                case "image":
                  return {
                    type: "image_url",
                    image_url: {
                      url: part.image.toString(),
                      ...(part.providerMetadata
                        ? { providerMetadata: part.providerMetadata }
                        : {}),
                    },
                  };
                default:
                  // We don't support files directly but also don't want to block them from being logged
                  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
                  return part as any;
              }
            }),
          },
        ];
      case "tool":
        return message.content.map((part) => ({
          role: "tool",
          tool_call_id: part.toolCallId,
          content: JSON.stringify(part.result),
        }));
    }
  });
}

export function postProcessOutput(
  text: string | undefined,
  toolCalls: LanguageModelV1FunctionToolCall[] | undefined,
  finishReason: LanguageModelV1FinishReason,
) {
  return [
    {
      index: 0,
      message: {
        role: "assistant",
        content: text ?? "",
        ...(toolCalls && toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((toolCall) => ({
                id: toolCall.toolCallId,
                function: {
                  name: toolCall.toolName,
                  arguments: toolCall.args,
                },
                type: "function" as const,
              })),
            }
          : {}),
      },
      finish_reason: finishReason,
    },
  ];
}
