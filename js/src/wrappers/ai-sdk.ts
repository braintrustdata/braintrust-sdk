import { Tools } from "@braintrust/core/typespecs";
import { startSpan } from "../logger";
import { getCurrentUnixTimestamp, isEmpty } from "../util";

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
  });
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

// NOTE: This type is copy-pasted from the ai-sdk so that Braintrust's SDK
// does not include the ai-sdk as a direct dependency.
type JSONSchema7 = any;

declare class APICallError extends Error {
  readonly url: string;
  readonly requestBodyValues: unknown;
  readonly statusCode?: number;
  readonly responseBody?: string;
  readonly cause?: unknown;
  readonly isRetryable: boolean;
  readonly data?: unknown;
  constructor({
    message,
    url,
    requestBodyValues,
    statusCode,
    responseBody,
    cause,
    isRetryable, // server error
    data,
  }: {
    message: string;
    url: string;
    requestBodyValues: unknown;
    statusCode?: number;
    responseBody?: string;
    cause?: unknown;
    isRetryable?: boolean;
    data?: unknown;
  });
  static isAPICallError(error: unknown): error is APICallError;
  toJSON(): {
    name: string;
    message: string;
    url: string;
    requestBodyValues: unknown;
    statusCode: number | undefined;
    responseBody: string | undefined;
    cause: unknown;
    isRetryable: boolean;
    data: unknown;
  };
}

declare class InvalidArgumentError extends Error {
  readonly parameter: string;
  readonly value: unknown;
  constructor({
    parameter,
    value,
    message,
  }: {
    parameter: string;
    value: unknown;
    message: string;
  });
  static isInvalidArgumentError(error: unknown): error is InvalidArgumentError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
    parameter: string;
    value: unknown;
  };
}

declare class InvalidDataContentError extends Error {
  readonly content: unknown;
  constructor({ content, message }: { content: unknown; message?: string });
  static isInvalidDataContentError(
    error: unknown
  ): error is InvalidDataContentError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
    content: unknown;
  };
}

declare class InvalidPromptError extends Error {
  readonly prompt: unknown;
  constructor({ prompt, message }: { prompt: unknown; message: string });
  static isInvalidPromptError(error: unknown): error is InvalidPromptError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
    prompt: unknown;
  };
}

/**
Server returned a response with invalid data content. This should be thrown by providers when they
cannot parse the response from the API.
 */
declare class InvalidResponseDataError extends Error {
  readonly data: unknown;
  constructor({ data, message }: { data: unknown; message?: string });
  static isInvalidResponseDataError(
    error: unknown
  ): error is InvalidResponseDataError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
    data: unknown;
  };
}

declare class InvalidToolArgumentsError extends Error {
  readonly toolName: string;
  readonly toolArgs: string;
  readonly cause: unknown;
  constructor({
    toolArgs,
    toolName,
    cause,
    message,
  }: {
    message?: string;
    toolArgs: string;
    toolName: string;
    cause: unknown;
  });
  static isInvalidToolArgumentsError(
    error: unknown
  ): error is InvalidToolArgumentsError;
  toJSON(): {
    name: string;
    message: string;
    cause: unknown;
    stack: string | undefined;
    toolName: string;
    toolArgs: string;
  };
}

declare class JSONParseError extends Error {
  readonly text: string;
  readonly cause: unknown;
  constructor({ text, cause }: { text: string; cause: unknown });
  static isJSONParseError(error: unknown): error is JSONParseError;
  toJSON(): {
    name: string;
    message: string;
    cause: unknown;
    stack: string | undefined;
    valueText: string;
  };
}

declare class LoadAPIKeyError extends Error {
  constructor({ message }: { message: string });
  static isLoadAPIKeyError(error: unknown): error is LoadAPIKeyError;
  toJSON(): {
    name: string;
    message: string;
  };
}

declare class NoTextGeneratedError extends Error {
  readonly cause: unknown;
  constructor();
  static isNoTextGeneratedError(error: unknown): error is NoTextGeneratedError;
  toJSON(): {
    name: string;
    cause: unknown;
    message: string;
    stack: string | undefined;
  };
}

declare class NoResponseBodyError extends Error {
  constructor({ message }?: { message?: string });
  static isNoResponseBodyError(error: unknown): error is NoResponseBodyError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
  };
}

declare class NoSuchToolError extends Error {
  readonly toolName: string;
  readonly availableTools: string[] | undefined;
  constructor({
    toolName,
    availableTools,
    message,
  }: {
    toolName: string;
    availableTools?: string[] | undefined;
    message?: string;
  });
  static isNoSuchToolError(error: unknown): error is NoSuchToolError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
    toolName: string;
    availableTools: string[] | undefined;
  };
}

type RetryErrorReason = "maxRetriesExceeded" | "errorNotRetryable" | "abort";
declare class RetryError extends Error {
  readonly reason: RetryErrorReason;
  readonly lastError: unknown;
  readonly errors: Array<unknown>;
  constructor({
    message,
    reason,
    errors,
  }: {
    message: string;
    reason: RetryErrorReason;
    errors: Array<unknown>;
  });
  static isRetryError(error: unknown): error is RetryError;
  toJSON(): {
    name: string;
    message: string;
    reason: RetryErrorReason;
    lastError: unknown;
    errors: unknown[];
  };
}

/**
A tool has a name, a description, and a set of parameters.

Note: this is **not** the user-facing tool definition. The AI SDK methods will
map the user-facing tool definitions to this format.
 */
type LanguageModelV1FunctionTool = {
  /**
  The type of the tool. Only functions for now, but this gives us room to
  add more specific tool types in the future and use a discriminated union.
     */
  type: "function";
  /**
  The name of the tool. Unique within this model call.
     */
  name: string;
  description?: string;
  parameters: JSONSchema7;
};

declare class ToolCallParseError extends Error {
  readonly cause: unknown;
  readonly text: string;
  readonly tools: LanguageModelV1FunctionTool[];
  constructor({
    cause,
    text,
    tools,
    message,
  }: {
    cause: unknown;
    text: string;
    tools: LanguageModelV1FunctionTool[];
    message?: string;
  });
  static isToolCallParseError(error: unknown): error is ToolCallParseError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
    cause: unknown;
    text: string;
    tools: LanguageModelV1FunctionTool[];
  };
}

declare class TypeValidationError extends Error {
  readonly value: unknown;
  readonly cause: unknown;
  constructor({ value, cause }: { value: unknown; cause: unknown });
  static isTypeValidationError(error: unknown): error is TypeValidationError;
  toJSON(): {
    name: string;
    message: string;
    cause: unknown;
    stack: string | undefined;
    value: unknown;
  };
}

declare class UnsupportedFunctionalityError extends Error {
  readonly functionality: string;
  constructor({ functionality }: { functionality: string });
  static isUnsupportedFunctionalityError(
    error: unknown
  ): error is UnsupportedFunctionalityError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
    functionality: string;
  };
}

declare class UnsupportedJSONSchemaError extends Error {
  readonly reason: string;
  readonly schema: unknown;
  constructor({
    schema,
    reason,
    message,
  }: {
    schema: unknown;
    reason: string;
    message?: string;
  });
  static isUnsupportedJSONSchemaError(
    error: unknown
  ): error is UnsupportedJSONSchemaError;
  toJSON(): {
    name: string;
    message: string;
    stack: string | undefined;
    reason: string;
    schema: unknown;
  };
}

type LanguageModelV1CallSettings = {
  /**
   * Maximum number of tokens to generate.
   */
  maxTokens?: number;
  /**
   * Temperature setting. This is a number between 0 (almost no randomness) and
   * 1 (very random).
   *
   * Different LLM providers have different temperature
   * scales, so they'd need to map it (without mapping, the same temperature has
   * different effects on different models). The provider can also chose to map
   * this to topP, potentially even using a custom setting on their model.
   *
   * Note: This is an example of a setting that requires a clear specification of
   * the semantics.
   */
  temperature?: number;
  /**
   * Nucleus sampling. This is a number between 0 and 1.
   *
   * E.g. 0.1 would mean that only tokens with the top 10% probability mass
   * are considered.
   *
   * It is recommended to set either `temperature` or `topP`, but not both.
   */
  topP?: number;
  /**
   * Presence penalty setting. It affects the likelihood of the model to
   * repeat information that is already in the prompt.
   *
   * The presence penalty is a number between -1 (increase repetition)
   * and 1 (maximum penalty, decrease repetition). 0 means no penalty.
   */
  presencePenalty?: number;
  /**
   * Frequency penalty setting. It affects the likelihood of the model
   * to repeatedly use the same words or phrases.
   *
   * The frequency penalty is a number between -1 (increase repetition)
   * and 1 (maximum penalty, decrease repetition). 0 means no penalty.
   */
  frequencyPenalty?: number;
  /**
   * The seed (integer) to use for random sampling. If set and supported
   * by the model, calls will generate deterministic results.
   */
  seed?: number;
  /**
   * Abort signal for cancelling the operation.
   */
  abortSignal?: AbortSignal;
};

/**
A prompt is a list of messages.

Note: Not all models and prompt formats support multi-modal inputs and
tool calls. The validation happens at runtime.

Note: This is not a user-facing prompt. The AI SDK methods will map the
user-facing prompt types such as chat or instruction prompts to this format.
 */
type LanguageModelV1Prompt = Array<LanguageModelV1Message>;
type LanguageModelV1Message =
  | {
      role: "system";
      content: string;
    }
  | {
      role: "user";
      content: Array<LanguageModelV1TextPart | LanguageModelV1ImagePart>;
    }
  | {
      role: "assistant";
      content: Array<LanguageModelV1TextPart | LanguageModelV1ToolCallPart>;
    }
  | {
      role: "tool";
      content: Array<LanguageModelV1ToolResultPart>;
    };
/**
Text content part of a prompt. It contains a string of text.
 */
interface LanguageModelV1TextPart {
  type: "text";
  /**
  The text content.
     */
  text: string;
}
/**
Image content part of a prompt. It contains an image.
 */
interface LanguageModelV1ImagePart {
  type: "image";
  /**
  Image data as a Uint8Array (e.g. from a Blob or Buffer) or a URL.
     */
  image: Uint8Array | URL;
  /**
  Optional mime type of the image.
     */
  mimeType?: string;
}
/**
Tool call content part of a prompt. It contains a tool call (usually generated by the AI model).
 */
interface LanguageModelV1ToolCallPart {
  type: "tool-call";
  /**
  ID of the tool call. This ID is used to match the tool call with the tool result.
   */
  toolCallId: string;
  /**
  Name of the tool that is being called.
   */
  toolName: string;
  /**
  Arguments of the tool call. This is a JSON-serializable object that matches the tool's input schema.
     */
  args: unknown;
}
/**
Tool result content part of a prompt. It contains the result of the tool call with the matching ID.
 */
interface LanguageModelV1ToolResultPart {
  type: "tool-result";
  /**
  ID of the tool call that this result is associated with.
   */
  toolCallId: string;
  /**
  Name of the tool that generated this result.
    */
  toolName: string;
  /**
  Result of the tool call. This is a JSON-serializable object.
     */
  result: unknown;
  /**
  Optional flag if the result is an error or an error message.
     */
  isError?: boolean;
}

type LanguageModelV1CallOptions = LanguageModelV1CallSettings & {
  /**
   * Whether the user provided the input as messages or as
   * a prompt. This can help guide non-chat models in the
   * expansion, bc different expansions can be needed for
   * chat/non-chat use cases.
   */
  inputFormat: "messages" | "prompt";
  /**
   * The mode affects the behavior of the language model. It is required to
   * support provider-independent streaming and generation of structured objects.
   * The model can take this information and e.g. configure json mode, the correct
   * low level grammar, etc. It can also be used to optimize the efficiency of the
   * streaming, e.g. tool-delta stream parts are only needed in the
   * object-tool mode.
   */
  mode:
    | {
        type: "regular";
        tools?: Array<LanguageModelV1FunctionTool>;
      }
    | {
        type: "object-json";
      }
    | {
        type: "object-grammar";
        schema: JSONSchema7;
      }
    | {
        type: "object-tool";
        tool: LanguageModelV1FunctionTool;
      };
  /**
   * A language mode prompt is a standardized prompt type.
   *
   * Note: This is **not** the user-facing prompt. The AI SDK methods will map the
   * user-facing prompt types such as chat or instruction prompts to this format.
   * That approach allows us to evolve the user  facing prompts without breaking
   * the language model interface.
   */
  prompt: LanguageModelV1Prompt;
};

/**
 * Warning from the model provider for this call. The call will proceed, but e.g.
 * some settings might not be supported, which can lead to suboptimal results.
 */
type LanguageModelV1CallWarning =
  | {
      type: "unsupported-setting";
      setting: keyof LanguageModelV1CallSettings;
    }
  | {
      type: "other";
      message: string;
    };

type LanguageModelV1FinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other";

type LanguageModelV1FunctionToolCall = {
  toolCallType: "function";
  toolCallId: string;
  toolName: string;
  /**
   * Stringified JSON object with the tool call arguments. Must match the
   * parameters schema of the tool.
   */
  args: string;
};

/**
 * Experimental: Specification for a language model that implements the language model
 * interface version 1.
 */
type LanguageModelV1 = {
  /**
   * The language model must specify which language model interface
   * version it implements. This will allow us to evolve the language
   * model interface and retain backwards compatibility. The different
   * implementation versions can be handled as a discriminated union
   * on our side.
   */
  readonly specificationVersion: "v1";
  /**
   * Name of the provider for logging purposes.
   */
  readonly provider: string;
  /**
   * Provider-specific model ID for logging purposes.
   */
  readonly modelId: string;
  /**
   * Default object generation mode that should be used with this model when
   * no mode is specified. Should be the mode with the best results for this
   * model. `undefined` can be returned if object generation is not supported.
   *
   * This is needed to generate the best objects possible w/o requiring the
   * user to explicitly specify the object generation mode.
   */
  readonly defaultObjectGenerationMode: "json" | "tool" | "grammar" | undefined;
  /**
   * Generates a language model output (non-streaming).
   *
   * Naming: "do" prefix to prevent accidental direct usage of the method
   * by the user.
   */
  doGenerate(options: LanguageModelV1CallOptions): PromiseLike<{
    /**
     * Text that the model has generated. Can be undefined if the model
     * has only generated tool calls.
     */
    text?: string;
    /**
     * Tool calls that the model has generated. Can be undefined if the
     * model has only generated text.
     */
    toolCalls?: Array<LanguageModelV1FunctionToolCall>;
    /**
     * Finish reason.
     */
    finishReason: LanguageModelV1FinishReason;
    /**
     * Usage information.
     */
    usage: {
      promptTokens: number;
      completionTokens: number;
    };
    /**
     * Raw prompt and setting information for observability provider integration.
     */
    rawCall: {
      /**
       * Raw prompt after expansion and conversion to the format that the
       * provider uses to send the information to their API.
       */
      rawPrompt: unknown;
      /**
       * Raw settings that are used for the API call. Includes provider-specific
       * settings.
       */
      rawSettings: Record<string, unknown>;
    };
    warnings?: LanguageModelV1CallWarning[];
  }>;
  /**
   * Generates a language model output (streaming).
   *
   * Naming: "do" prefix to prevent accidental direct usage of the method
   * by the user.
   *
   * @return A stream of higher-level language model output parts.
   */
  doStream(options: LanguageModelV1CallOptions): PromiseLike<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    /**
     * Raw prompt and setting information for observability provider integration.
     */
    rawCall: {
      /**
       * Raw prompt after expansion and conversion to the format that the
       * provider uses to send the information to their API.
       */
      rawPrompt: unknown;
      /**
       * Raw settings that are used for the API call. Includes provider-specific
       * settings.
       */
      rawSettings: Record<string, unknown>;
    };
    warnings?: LanguageModelV1CallWarning[];
  }>;
};
type LanguageModelV1StreamPart =
  | {
      type: "text-delta";
      textDelta: string;
    }
  | ({
      type: "tool-call";
    } & LanguageModelV1FunctionToolCall)
  | {
      type: "tool-call-delta";
      toolCallType: "function";
      toolCallId: string;
      toolName: string;
      argsTextDelta: string;
    }
  | {
      type: "finish";
      finishReason: LanguageModelV1FinishReason;
      usage: {
        promptTokens: number;
        completionTokens: number;
      };
    }
  | {
      type: "error";
      error: unknown;
    };
