import { Tools } from "@braintrust/core/typespecs";
import { startSpan } from "../logger";
import { getCurrentUnixTimestamp, isEmpty } from "../util";
import {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1FinishReason,
  LanguageModelV1FunctionTool,
  LanguageModelV1FunctionToolCall,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";

/**
 * Wrap an ai-sdk model (created with `.chat()`, `.completion()`, etc.) to add tracing. If Braintrust is
 * not configured, this is a no-op
 *
 * @param model
 * @returns The wrapped object.
 */
export function wrapAISDKModel<T extends object>(model: T): T {
  const m = model as any;
  if (
    m?.specificationVersion === "v1" &&
    typeof m?.provider === "string" &&
    typeof m?.modelId === "string"
  ) {
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

  get defaultObjectGenerationMode(): "json" | "tool" | "grammar" | undefined {
    return this.model.defaultObjectGenerationMode;
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
        input: prompt,
        metadata: {
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
      input: prompt,
      metadata: {
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
      let toolCalls: Record<string, LanguageModelV1FunctionToolCall> = {};
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
                  finishReason!
                ),
                metrics: {
                  time_to_first_token: getCurrentUnixTimestamp() - startTime,
                  tokens: !isEmpty(usage)
                    ? usage.promptTokens + usage.completionTokens
                    : undefined,
                  prompt_tokens: usage?.promptTokens,
                  completion_tokens: usage?.completionTokens,
                },
              });
              end();
              controller.terminate();
            },
          })
        ),
      };
    } finally {
      end();
    }
  }
}

function convertTools(tools: LanguageModelV1FunctionTool[]): Tools {
  return tools.map((tool) => {
    const { type, ...rest } = tool;
    return {
      type: tool.type,
      function: rest,
    };
  }) as Tools;
}

function postProcessOutput(
  text: string | undefined,
  tool_calls: LanguageModelV1FunctionToolCall[] | undefined,
  finish_reason: LanguageModelV1FinishReason
) {
  return {
    text,
    tool_calls,
    finish_reason,
  };
}
