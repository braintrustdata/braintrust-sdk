import { BasePlugin } from "../core";
import {
  traceAsyncChannel,
  traceStreamingChannel,
  traceSyncStreamChannel,
  unsubscribeAll,
} from "../core/channel-tracing";
import type { ChannelMessage } from "../core/channel-definitions";
import { SpanTypeAttribute, isObject } from "../../../util/index";
import { withCurrent } from "../../logger";
import type { Span } from "../../logger";
import { getCurrentUnixTimestamp } from "../../util";
import { patchOpenRouterCallModelRequestTools } from "../../openrouter-tool-wrapping";
import {
  buildOpenRouterEmbeddingMetadata,
  buildOpenRouterMetadata,
  extractOpenRouterCallModelInput,
  extractOpenRouterCallModelMetadata,
  extractOpenRouterResponseMetadata,
  extractOpenRouterResponseOutput,
  sanitizeOpenRouterLoggedValue,
} from "../../openrouter-logging";
import { parseOpenRouterMetricsFromUsage } from "../../openrouter-utils";
import { openRouterChannels } from "./openrouter-channels";
import type {
  OpenRouterChatChoice,
  OpenRouterChatCompletionChunk,
  OpenRouterCallModelRequest,
  OpenRouterResponse,
  OpenRouterResponseStreamEvent,
} from "../../vendor-sdk-types/openrouter";

export class OpenRouterPlugin extends BasePlugin {
  protected onEnable(): void {
    this.subscribeToOpenRouterChannels();
  }

  protected onDisable(): void {
    this.unsubscribers = unsubscribeAll(this.unsubscribers);
  }

  private subscribeToOpenRouterChannels(): void {
    this.unsubscribers.push(
      traceStreamingChannel(openRouterChannels.chatSend, {
        name: "openrouter.chat.send",
        type: SpanTypeAttribute.LLM,
        extractInput: (args) => {
          const request = getOpenRouterRequestArg(args);
          const chatGenerationParams = isObject(request?.chatGenerationParams)
            ? request.chatGenerationParams
            : {};
          const httpReferer = request?.httpReferer;
          const xTitle = request?.xTitle;
          const { messages, ...metadata } = chatGenerationParams;
          return {
            input: messages,
            metadata: buildOpenRouterMetadata(metadata, httpReferer, xTitle),
          };
        },
        extractOutput: (result) => {
          return isObject(result) ? result.choices : undefined;
        },
        extractMetrics: (result, startTime) => {
          const metrics = parseOpenRouterMetricsFromUsage(result?.usage);
          if (startTime) {
            metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
          }
          return metrics;
        },
        aggregateChunks: aggregateOpenRouterChatChunks,
      }),
    );

    this.unsubscribers.push(
      traceAsyncChannel(openRouterChannels.embeddingsGenerate, {
        name: "openrouter.embeddings.generate",
        type: SpanTypeAttribute.LLM,
        extractInput: (args) => {
          const request = getOpenRouterRequestArg(args);
          const requestBody = isObject(request?.requestBody)
            ? request.requestBody
            : {};
          const httpReferer = request?.httpReferer;
          const xTitle = request?.xTitle;
          const { input, ...metadata } = requestBody;
          return {
            input,
            metadata: buildOpenRouterEmbeddingMetadata(
              metadata,
              httpReferer,
              xTitle,
            ),
          };
        },
        extractOutput: (result) => {
          if (!isObject(result)) {
            return undefined;
          }

          const embedding = result.data?.[0]?.embedding;
          return Array.isArray(embedding)
            ? { embedding_length: embedding.length }
            : undefined;
        },
        extractMetadata: (result) => {
          if (!isObject(result)) {
            return undefined;
          }

          return extractOpenRouterResponseMetadata(result);
        },
        extractMetrics: (result) => {
          return isObject(result)
            ? parseOpenRouterMetricsFromUsage(result.usage)
            : {};
        },
      }),
    );

    this.unsubscribers.push(
      traceStreamingChannel(openRouterChannels.betaResponsesSend, {
        name: "openrouter.beta.responses.send",
        type: SpanTypeAttribute.LLM,
        extractInput: (args) => {
          const request = getOpenRouterRequestArg(args);
          const openResponsesRequest = isObject(request?.openResponsesRequest)
            ? request.openResponsesRequest
            : {};
          const httpReferer = request?.httpReferer;
          const xTitle = request?.xTitle;
          const { input, ...metadata } = openResponsesRequest;
          return {
            input,
            metadata: buildOpenRouterMetadata(metadata, httpReferer, xTitle),
          };
        },
        extractOutput: (result) =>
          extractOpenRouterResponseOutput(result as Record<string, unknown>),
        extractMetadata: (result) => extractOpenRouterResponseMetadata(result),
        extractMetrics: (result, startTime) => {
          const metrics = parseOpenRouterMetricsFromUsage(result?.usage);
          if (startTime) {
            metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
          }
          return metrics;
        },
        aggregateChunks: aggregateOpenRouterResponseStreamEvents,
      }),
    );

    this.unsubscribers.push(
      traceSyncStreamChannel(openRouterChannels.callModel, {
        name: "openrouter.callModel",
        type: SpanTypeAttribute.LLM,
        extractInput: (args) => {
          const request = getOpenRouterCallModelRequestArg(args);
          return {
            input: request
              ? extractOpenRouterCallModelInput(request)
              : undefined,
            metadata: request
              ? extractOpenRouterCallModelMetadata(request)
              : { provider: "openrouter" },
          };
        },
        patchResult: ({ endEvent, result, span }) => {
          return patchOpenRouterCallModelResult({
            request: getOpenRouterCallModelRequestArg(endEvent.arguments),
            result,
            span,
          });
        },
      }),
    );

    this.unsubscribers.push(
      traceAsyncChannel(openRouterChannels.callModelTurn, {
        name: "openrouter.beta.responses.send",
        type: SpanTypeAttribute.LLM,
        extractInput: (args, event) => {
          const request = getOpenRouterCallModelRequestArg(args);
          const metadata = request
            ? extractOpenRouterCallModelMetadata(request)
            : { provider: "openrouter" };

          if (isObject(metadata) && "tools" in metadata) {
            delete (metadata as Record<string, unknown>).tools;
          }

          return {
            input: request
              ? extractOpenRouterCallModelInput(request)
              : undefined,
            metadata: {
              ...metadata,
              step: event.step,
              step_type: event.stepType,
            },
          };
        },
        extractOutput: (result) =>
          extractOpenRouterResponseOutput(result as Record<string, unknown>),
        extractMetadata: (result, event) => {
          if (!isObject(result)) {
            return {
              step: event?.step,
              step_type: event?.stepType,
            };
          }

          return {
            ...(extractOpenRouterResponseMetadata(result) || {}),
            ...(event?.step !== undefined ? { step: event.step } : {}),
            ...(event?.stepType ? { step_type: event.stepType } : {}),
          };
        },
        extractMetrics: (result) =>
          isObject(result) ? parseOpenRouterMetricsFromUsage(result.usage) : {},
      }),
    );

    this.unsubscribers.push(
      traceStreamingChannel(openRouterChannels.toolExecute, {
        name: "openrouter.tool",
        type: SpanTypeAttribute.TOOL,
        extractInput: (args, event) => ({
          input: args[0],
          metadata: {
            provider: "openrouter",
            tool_name: event.toolName,
            ...(event.toolCallId ? { tool_call_id: event.toolCallId } : {}),
          },
        }),
        extractOutput: (result) => result,
        extractMetrics: () => ({}),
        aggregateChunks: (chunks) => ({
          output: chunks.length > 0 ? chunks[chunks.length - 1] : undefined,
          metrics: {},
        }),
      }),
    );

    const callModelChannel = openRouterChannels.callModel.tracingChannel();
    const callModelHandlers = {
      start: (event: { arguments: unknown[] }) => {
        const request = getOpenRouterCallModelRequestArg(event.arguments);
        if (!request) {
          return;
        }

        patchOpenRouterCallModelRequestTools(request);
      },
    };

    callModelChannel.subscribe(callModelHandlers);
    this.unsubscribers.push(() => {
      callModelChannel.unsubscribe(callModelHandlers);
    });
  }
}

function normalizeArgs(args: unknown[] | unknown): unknown[] {
  if (Array.isArray(args)) {
    return args;
  }

  if (isArrayLike(args)) {
    return Array.from(args);
  }

  return [args];
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return (
    isObject(value) &&
    "length" in value &&
    typeof value.length === "number" &&
    Number.isInteger(value.length) &&
    value.length >= 0
  );
}

function getOpenRouterRequestArg(
  args: unknown[] | unknown,
): Record<string, unknown> | undefined {
  const normalizedArgs = normalizeArgs(args);
  const keyedCandidate = normalizedArgs.find(
    (arg) =>
      isObject(arg) &&
      ("chatGenerationParams" in arg ||
        "requestBody" in arg ||
        "openResponsesRequest" in arg),
  );

  if (isObject(keyedCandidate)) {
    return keyedCandidate;
  }

  const firstObjectArg = normalizedArgs.find((arg) => isObject(arg));
  return isObject(firstObjectArg) ? firstObjectArg : undefined;
}

function getOpenRouterCallModelRequestArg(
  args: unknown[] | unknown,
): OpenRouterCallModelRequest | undefined {
  const firstObjectArg = normalizeArgs(args).find((arg) => isObject(arg));
  return isObject(firstObjectArg)
    ? (firstObjectArg as OpenRouterCallModelRequest)
    : undefined;
}

export function aggregateOpenRouterChatChunks(
  chunks: OpenRouterChatCompletionChunk[],
): {
  output: OpenRouterChatChoice[];
  metrics: Record<string, number>;
} {
  let role: string | undefined;
  let content = "";
  let toolCalls:
    | Array<{
        index?: number;
        id?: string;
        type?: string;
        function: {
          name?: string;
          arguments: string;
        };
      }>
    | undefined;
  let finishReason: string | null | undefined;
  let metrics: Record<string, number> = {};

  for (const chunk of chunks) {
    metrics = {
      ...metrics,
      ...parseOpenRouterMetricsFromUsage(chunk?.usage),
    };

    const choice = chunk?.choices?.[0];
    const delta = choice?.delta;
    if (!delta) {
      if (choice?.finish_reason !== undefined) {
        finishReason = choice.finish_reason;
      }
      continue;
    }

    if (!role && delta.role) {
      role = delta.role;
    }

    if (typeof delta.content === "string") {
      content += delta.content;
    }

    const choiceFinishReason =
      choice?.finishReason ?? choice?.finish_reason ?? undefined;
    const deltaFinishReason =
      delta.finishReason ?? delta.finish_reason ?? undefined;

    if (choiceFinishReason !== undefined) {
      finishReason = choiceFinishReason;
    } else if (deltaFinishReason !== undefined) {
      finishReason = deltaFinishReason;
    }

    const toolCallDeltas = Array.isArray(delta.toolCalls)
      ? delta.toolCalls
      : Array.isArray(delta.tool_calls)
        ? delta.tool_calls
        : undefined;

    if (!toolCallDeltas) {
      continue;
    }

    for (const toolDelta of toolCallDeltas) {
      if (!toolDelta?.function) {
        continue;
      }

      const toolIndex = toolDelta.index ?? 0;
      const existingToolCall = toolCalls?.[toolIndex];

      if (
        !existingToolCall ||
        (toolDelta.id &&
          existingToolCall.id !== undefined &&
          existingToolCall.id !== toolDelta.id)
      ) {
        const nextToolCalls = [...(toolCalls || [])];
        nextToolCalls[toolIndex] = {
          index: toolIndex,
          id: toolDelta.id,
          type: toolDelta.type,
          function: {
            name: toolDelta.function.name,
            arguments: toolDelta.function.arguments || "",
          },
        };
        toolCalls = nextToolCalls;
        continue;
      }

      const current = existingToolCall;
      if (toolDelta.id && !current.id) {
        current.id = toolDelta.id;
      }
      if (toolDelta.type && !current.type) {
        current.type = toolDelta.type;
      }
      if (toolDelta.function.name && !current.function.name) {
        current.function.name = toolDelta.function.name;
      }
      current.function.arguments += toolDelta.function.arguments || "";
    }
  }

  return {
    output: [
      {
        index: 0,
        message: {
          role,
          content: content || undefined,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
    metrics,
  };
}

export function aggregateOpenRouterResponseStreamEvents(
  chunks: OpenRouterResponseStreamEvent[],
): {
  output: unknown;
  metrics: Record<string, number>;
  metadata?: Record<string, unknown>;
} {
  let finalResponse: OpenRouterResponse | undefined;

  for (const chunk of chunks) {
    const response = chunk?.response;
    if (!response) {
      continue;
    }

    if (
      chunk.type === "response.completed" ||
      chunk.type === "response.incomplete" ||
      chunk.type === "response.failed"
    ) {
      finalResponse = response;
    }
  }

  if (!finalResponse) {
    return {
      output: undefined,
      metrics: {},
    };
  }

  return {
    output: extractOpenRouterResponseOutput(finalResponse),
    metrics: parseOpenRouterMetricsFromUsage(finalResponse.usage),
    ...(extractOpenRouterResponseMetadata(finalResponse)
      ? { metadata: extractOpenRouterResponseMetadata(finalResponse) }
      : {}),
  };
}

const OPENROUTER_WRAPPED_CALL_MODEL_RESULT = Symbol(
  "braintrust.openrouter.wrappedCallModelResult",
);

const OPENROUTER_CALL_MODEL_STREAM_METHODS = [
  "getFullResponsesStream",
  "getItemsStream",
  "getNewMessagesStream",
  "getReasoningStream",
  "getTextStream",
  "getToolCallsStream",
  "getToolStream",
] as const;

const OPENROUTER_CALL_MODEL_CONTEXT_METHODS = [
  "cancel",
  "getPendingToolCalls",
  "getState",
  "getToolCalls",
  "requiresApproval",
] as const;

type OpenRouterCallModelTurnTraceContext = ChannelMessage<
  typeof openRouterChannels.callModelTurn
>;

type OpenRouterCallModelResultLike = {
  [OPENROUTER_WRAPPED_CALL_MODEL_RESULT]?: true;
  allToolExecutionRounds?: unknown;
  finalResponse?: unknown;
  getInitialResponse?: (...args: unknown[]) => Promise<unknown>;
  getResponse?: (...args: unknown[]) => Promise<unknown>;
  makeFollowupRequest?: (...args: unknown[]) => Promise<unknown>;
  resolvedRequest?: unknown;
  getText?: (...args: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
};

function patchOpenRouterCallModelResult(args: {
  request?: OpenRouterCallModelRequest;
  result: unknown;
  span: Span;
}): boolean {
  const { request, result, span } = args;
  if (!isObject(result) || isWrappedCallModelResult(result)) {
    return false;
  }

  const resultLike = result as OpenRouterCallModelResultLike;
  const hasInstrumentableMethod =
    typeof resultLike.getResponse === "function" ||
    typeof resultLike.getText === "function" ||
    OPENROUTER_CALL_MODEL_STREAM_METHODS.some(
      (methodName) => typeof resultLike[methodName] === "function",
    );

  if (!hasInstrumentableMethod) {
    return false;
  }

  Object.defineProperty(resultLike, OPENROUTER_WRAPPED_CALL_MODEL_RESULT, {
    value: true,
    enumerable: false,
    configurable: false,
  });

  const originalGetResponse =
    typeof resultLike.getResponse === "function"
      ? resultLike.getResponse.bind(resultLike)
      : undefined;
  const originalGetInitialResponse =
    typeof resultLike.getInitialResponse === "function"
      ? resultLike.getInitialResponse.bind(resultLike)
      : undefined;
  const originalMakeFollowupRequest =
    typeof resultLike.makeFollowupRequest === "function"
      ? resultLike.makeFollowupRequest.bind(resultLike)
      : undefined;

  let ended = false;
  let tracedTurnCount = 0;

  const endSpanWithResult = async (
    response?: unknown,
    fallbackOutput?: unknown,
  ) => {
    if (ended) {
      return;
    }
    ended = true;

    const finalResponse = getFinalOpenRouterCallModelResponse(
      resultLike,
      response,
    );
    if (finalResponse) {
      const rounds = getOpenRouterCallModelRounds(resultLike);

      const metadata = extractOpenRouterCallModelResultMetadata(
        finalResponse,
        rounds.length + 1,
      );
      span.log({
        output: extractOpenRouterResponseOutput(finalResponse, fallbackOutput),
        ...(metadata ? { metadata } : {}),
        metrics: aggregateOpenRouterCallModelMetrics(rounds, finalResponse),
      });
      span.end();
      return;
    }

    if (fallbackOutput !== undefined) {
      span.log({
        output: fallbackOutput,
      });
    }

    span.end();
  };

  const endSpanWithError = (error: unknown) => {
    if (ended) {
      return;
    }
    ended = true;
    span.log({
      error: normalizeError(error).message,
    });
    span.end();
  };

  const finalizeFromResponse = async (fallbackOutput?: unknown) => {
    if (!originalGetResponse) {
      await endSpanWithResult(undefined, fallbackOutput);
      return;
    }

    try {
      await endSpanWithResult(await originalGetResponse(), fallbackOutput);
    } catch {
      await endSpanWithResult(undefined, fallbackOutput);
    }
  };

  if (originalGetResponse) {
    resultLike.getResponse = async (...args: unknown[]) => {
      return await withCurrent(span, async () => {
        try {
          const response = await originalGetResponse(...args);
          await endSpanWithResult(response);
          return response;
        } catch (error) {
          endSpanWithError(error);
          throw error;
        }
      });
    };
  }

  if (typeof resultLike.getText === "function") {
    const originalGetText = resultLike.getText.bind(resultLike);
    resultLike.getText = async (...args: unknown[]) => {
      return await withCurrent(span, async () => {
        try {
          const text = await originalGetText(...args);
          await finalizeFromResponse(text);
          return text;
        } catch (error) {
          endSpanWithError(error);
          throw error;
        }
      });
    };
  }

  for (const methodName of OPENROUTER_CALL_MODEL_CONTEXT_METHODS) {
    if (typeof resultLike[methodName] !== "function") {
      continue;
    }

    const originalMethod = resultLike[methodName] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    resultLike[methodName] = async (...args: unknown[]) => {
      return await withCurrent(span, async () => {
        return await originalMethod.apply(resultLike, args);
      });
    };
  }

  for (const methodName of OPENROUTER_CALL_MODEL_STREAM_METHODS) {
    if (typeof resultLike[methodName] !== "function") {
      continue;
    }

    const originalMethod = resultLike[methodName] as (
      ...args: unknown[]
    ) => AsyncIterable<unknown>;
    resultLike[methodName] = (...args: unknown[]) => {
      const stream = withCurrent(span, () =>
        originalMethod.apply(resultLike, args),
      );
      if (!isAsyncIterable(stream)) {
        return stream;
      }

      return wrapAsyncIterableWithSpan({
        finalize: finalizeFromResponse,
        iteratorFactory: () => stream[Symbol.asyncIterator](),
        onError: endSpanWithError,
        span,
      });
    };
  }

  if (originalGetInitialResponse) {
    let initialTurnTraced = false;
    resultLike.getInitialResponse = async (...args: unknown[]) => {
      if (initialTurnTraced) {
        return await withCurrent(span, async () => {
          return await originalGetInitialResponse(...args);
        });
      }

      initialTurnTraced = true;
      const step = tracedTurnCount + 1;
      const stepType = tracedTurnCount === 0 ? "initial" : "continue";

      const response = await traceOpenRouterCallModelTurn({
        fn: async () => {
          const nextResponse = await originalGetInitialResponse(...args);
          tracedTurnCount++;
          return nextResponse;
        },
        parentSpan: span,
        request: getOpenRouterResolvedRequest(resultLike, request),
        step,
        stepType,
      });

      return response;
    };
  }

  if (originalMakeFollowupRequest) {
    resultLike.makeFollowupRequest = async (...args: unknown[]) => {
      const currentResponse = args[0];
      const toolResults = Array.isArray(args[1]) ? args[1] : [];
      const step = tracedTurnCount + 1;

      const response = await traceOpenRouterCallModelTurn({
        fn: async () => {
          const nextResponse = await originalMakeFollowupRequest(...args);
          tracedTurnCount++;
          return nextResponse;
        },
        parentSpan: span,
        request: buildOpenRouterFollowupRequest(
          getOpenRouterResolvedRequest(resultLike, request),
          currentResponse,
          toolResults,
        ),
        step,
        stepType: "continue",
      });

      return response;
    };
  }

  return true;
}

async function traceOpenRouterCallModelTurn<TResult>(args: {
  fn: () => Promise<TResult>;
  parentSpan: Span;
  request: OpenRouterCallModelRequest | undefined;
  step: number;
  stepType: "initial" | "continue";
}): Promise<TResult> {
  const context: OpenRouterCallModelTurnTraceContext = {
    arguments: [args.request],
    step: args.step,
    stepType: args.stepType,
  };

  return await withCurrent(args.parentSpan, () =>
    openRouterChannels.callModelTurn.tracePromise(args.fn, context),
  );
}

function isWrappedCallModelResult(value: unknown): boolean {
  return Boolean(
    isObject(value) &&
    (value as OpenRouterCallModelResultLike)[
      OPENROUTER_WRAPPED_CALL_MODEL_RESULT
    ],
  );
}

function extractOpenRouterCallModelResultMetadata(
  response: Record<string, unknown>,
  turnCount?: number,
): Record<string, unknown> | undefined {
  const combined = {
    ...(extractOpenRouterResponseMetadata(response) || {}),
    ...(turnCount !== undefined ? { turn_count: turnCount } : {}),
  };

  return Object.keys(combined).length > 0 ? combined : undefined;
}

function getFinalOpenRouterCallModelResponse(
  result: OpenRouterCallModelResultLike,
  response: unknown,
): Record<string, unknown> | undefined {
  if (isObject(response)) {
    return response;
  }

  return isObject(result.finalResponse)
    ? (result.finalResponse as Record<string, unknown>)
    : undefined;
}

type OpenRouterCallModelRound = {
  response?: Record<string, unknown>;
  round?: number;
  toolResults?: unknown[];
};

function getOpenRouterCallModelRounds(
  result: OpenRouterCallModelResultLike,
): OpenRouterCallModelRound[] {
  if (!Array.isArray(result.allToolExecutionRounds)) {
    return [];
  }

  return result.allToolExecutionRounds
    .filter((round): round is Record<string, unknown> => isObject(round))
    .map((round) => ({
      response: isObject(round.response)
        ? (round.response as Record<string, unknown>)
        : undefined,
      round: typeof round.round === "number" ? round.round : undefined,
      toolResults: Array.isArray(round.toolResults) ? round.toolResults : [],
    }))
    .filter((round) => round.response !== undefined);
}

function aggregateOpenRouterCallModelMetrics(
  rounds: OpenRouterCallModelRound[],
  finalResponse: Record<string, unknown>,
): Record<string, number> {
  const metrics: Record<string, number> = {};
  const responses = [
    ...rounds.map((round) => round.response).filter(isObject),
    finalResponse,
  ];

  for (const response of responses) {
    const responseMetrics = parseOpenRouterMetricsFromUsage(response.usage);
    for (const [name, value] of Object.entries(responseMetrics)) {
      metrics[name] = (metrics[name] || 0) + value;
    }
  }

  return metrics;
}

function buildNextOpenRouterCallModelInput(
  currentInput: unknown,
  response: Record<string, unknown>,
  toolResults: unknown[],
): unknown {
  const normalizedInput = Array.isArray(currentInput)
    ? [...currentInput]
    : currentInput === undefined
      ? []
      : [currentInput];
  const responseOutput = Array.isArray(response.output)
    ? response.output
    : response.output === undefined
      ? []
      : [response.output];

  return [...normalizedInput, ...responseOutput, ...toolResults].map((entry) =>
    sanitizeOpenRouterLoggedValue(entry),
  );
}

function getOpenRouterResolvedRequest(
  result: OpenRouterCallModelResultLike,
  request: OpenRouterCallModelRequest | undefined,
): OpenRouterCallModelRequest | undefined {
  if (isObject(result.resolvedRequest)) {
    return result.resolvedRequest as OpenRouterCallModelRequest;
  }

  return request;
}

function buildOpenRouterFollowupRequest(
  request: OpenRouterCallModelRequest | undefined,
  currentResponse: unknown,
  toolResults: unknown[],
): OpenRouterCallModelRequest | undefined {
  if (!request) {
    return undefined;
  }

  return {
    ...request,
    input: buildNextOpenRouterCallModelInput(
      extractOpenRouterCallModelInput(request),
      isObject(currentResponse)
        ? (currentResponse as Record<string, unknown>)
        : {},
      toolResults,
    ),
    stream: false,
  };
}

function wrapAsyncIterableWithSpan(args: {
  finalize: (fallbackOutput?: unknown) => Promise<void>;
  iteratorFactory: () => AsyncIterator<unknown>;
  onError: (error: unknown) => void;
  span: Span;
}): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = args.iteratorFactory();
      return {
        next(value?: unknown) {
          return withCurrent(args.span, () =>
            value === undefined
              ? iterator.next()
              : (
                  iterator.next as (
                    value: unknown,
                  ) => Promise<IteratorResult<unknown>>
                )(value),
          ).then(
            async (result) => {
              if (result.done) {
                await args.finalize();
              }
              return result;
            },
            (error) => {
              args.onError(error);
              throw error;
            },
          );
        },
        return(value?: unknown) {
          if (typeof iterator.return !== "function") {
            return args.finalize().then(() => ({
              done: true,
              value,
            }));
          }

          return withCurrent(args.span, () => iterator.return!(value)).then(
            async (result) => {
              await args.finalize();
              return result;
            },
            (error) => {
              args.onError(error);
              throw error;
            },
          );
        },
        throw(error?: unknown) {
          args.onError(error);
          if (typeof iterator.throw !== "function") {
            return Promise.reject(error);
          }
          return withCurrent(args.span, () => iterator.throw!(error));
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export { parseOpenRouterMetricsFromUsage };
