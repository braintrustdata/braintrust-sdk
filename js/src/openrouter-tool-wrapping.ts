import { startSpan, withCurrent } from "./logger";
import type { Span } from "./logger";
import { openRouterChannels } from "./instrumentation/plugins/openrouter-channels";
import type { ChannelMessage } from "./instrumentation/core/channel-definitions";
import {
  extractOpenRouterCallModelInput,
  extractOpenRouterCallModelMetadata,
  extractOpenRouterResponseMetadata,
  extractOpenRouterResponseOutput,
  sanitizeOpenRouterLoggedValue,
} from "./openrouter-logging";
import { parseOpenRouterMetricsFromUsage } from "./openrouter-utils";
import { SpanTypeAttribute, isObject } from "../util/index";
import type {
  OpenRouterCallModelRequest,
  OpenRouterTool,
  OpenRouterToolTurnContext,
} from "./vendor-sdk-types/openrouter";

const OPENROUTER_WRAPPED_TOOL = Symbol("braintrust.openrouter.wrappedTool");
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

type OpenRouterToolTraceContext = ChannelMessage<
  typeof openRouterChannels.toolExecute
>;

type WrappedOpenRouterTool = OpenRouterTool & {
  [OPENROUTER_WRAPPED_TOOL]?: true;
};

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

export function startOpenRouterCallModelSpan(
  request: OpenRouterCallModelRequest,
): Span {
  return startSpan({
    name: "openrouter.callModel",
    spanAttributes: {
      type: SpanTypeAttribute.LLM,
    },
    event: {
      input: extractOpenRouterCallModelInput(request),
      metadata: extractOpenRouterCallModelMetadata(request),
    },
  });
}

export function patchOpenRouterCallModelRequestTools(
  request: OpenRouterCallModelRequest,
): (() => void) | undefined {
  if (!Array.isArray(request.tools) || request.tools.length === 0) {
    return undefined;
  }

  const originalTools = request.tools;
  const wrappedTools = originalTools.map((tool) => wrapOpenRouterTool(tool));
  const didPatch = wrappedTools.some(
    (tool, index) => tool !== originalTools[index],
  );
  if (!didPatch) {
    return undefined;
  }

  (request as { tools?: readonly OpenRouterTool[] }).tools = wrappedTools;
  return () => {
    (request as { tools?: readonly OpenRouterTool[] }).tools = originalTools;
  };
}

export function patchOpenRouterCallModelResult(
  span: Span,
  result: unknown,
  request?: OpenRouterCallModelRequest,
): boolean {
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
      const resolvedRequest = getOpenRouterResolvedRequest(resultLike, request);
      const childSpan = startOpenRouterCallModelTurnSpan({
        request: resolvedRequest,
        step: tracedTurnCount + 1,
        stepType: tracedTurnCount === 0 ? "initial" : "continue",
      });

      return await withCurrent(childSpan, async () => {
        try {
          const response = await originalGetInitialResponse(...args);
          tracedTurnCount++;
          finishOpenRouterCallModelTurnSpan({
            response,
            step: tracedTurnCount,
            stepType: tracedTurnCount === 1 ? "initial" : "continue",
            span: childSpan,
          });
          return response;
        } catch (error) {
          childSpan.log({
            error: normalizeError(error).message,
          });
          childSpan.end();
          throw error;
        }
      });
    };
  }

  if (originalMakeFollowupRequest) {
    resultLike.makeFollowupRequest = async (...args: unknown[]) => {
      const currentResponse = args[0];
      const toolResults = Array.isArray(args[1]) ? args[1] : [];
      const resolvedRequest = getOpenRouterResolvedRequest(resultLike, request);
      const followupRequest = buildOpenRouterFollowupRequest(
        resolvedRequest,
        currentResponse,
        toolResults,
      );
      const childSpan = startOpenRouterCallModelTurnSpan({
        request: followupRequest,
        step: tracedTurnCount + 1,
        stepType: "continue",
      });

      return await withCurrent(childSpan, async () => {
        try {
          const response = await originalMakeFollowupRequest(...args);
          tracedTurnCount++;
          finishOpenRouterCallModelTurnSpan({
            response,
            step: tracedTurnCount,
            stepType: "continue",
            span: childSpan,
          });
          return response;
        } catch (error) {
          childSpan.log({
            error: normalizeError(error).message,
          });
          childSpan.end();
          throw error;
        }
      });
    };
  }

  return true;
}

function wrapOpenRouterTool(tool: OpenRouterTool): OpenRouterTool {
  if (
    isWrappedTool(tool) ||
    !tool.function ||
    typeof tool.function !== "object" ||
    typeof tool.function.execute !== "function"
  ) {
    return tool;
  }

  const toolName = tool.function.name || "tool";
  const originalExecute = tool.function.execute;
  const wrappedTool: WrappedOpenRouterTool = {
    ...tool,
    function: {
      ...tool.function,
      execute(this: unknown, ...args: unknown[]) {
        return traceToolExecution({
          args,
          execute: () => Reflect.apply(originalExecute, this, args),
          toolCallId: getToolCallId(args[1]),
          toolName,
        });
      },
    },
  };

  Object.defineProperty(wrappedTool, OPENROUTER_WRAPPED_TOOL, {
    value: true,
    enumerable: false,
    configurable: false,
  });

  return wrappedTool;
}

function isWrappedTool(tool: OpenRouterTool): boolean {
  return Boolean((tool as WrappedOpenRouterTool)[OPENROUTER_WRAPPED_TOOL]);
}

function isWrappedCallModelResult(value: unknown): boolean {
  return Boolean(
    isObject(value) &&
    (value as OpenRouterCallModelResultLike)[
      OPENROUTER_WRAPPED_CALL_MODEL_RESULT
    ],
  );
}

function traceToolExecution(args: {
  args: unknown[];
  execute: () => unknown;
  toolCallId?: string;
  toolName: string;
}): unknown {
  const tracingChannel = openRouterChannels.toolExecute.tracingChannel();
  const input = args.args.length > 0 ? args.args[0] : undefined;
  const event: OpenRouterToolTraceContext = {
    arguments: [input],
    span_info: {
      name: args.toolName,
    },
    toolCallId: args.toolCallId,
    toolName: args.toolName,
  };

  tracingChannel.start!.publish(event);

  try {
    const result = args.execute();
    return publishToolResult(tracingChannel, event, result);
  } catch (error) {
    event.error = normalizeError(error);
    tracingChannel.error!.publish(event);
    throw error;
  }
}

function publishToolResult(
  tracingChannel: ReturnType<
    typeof openRouterChannels.toolExecute.tracingChannel
  >,
  event: OpenRouterToolTraceContext,
  result: unknown,
): unknown {
  if (isPromiseLike(result)) {
    return result.then(
      (resolved) => {
        event.result = resolved;
        tracingChannel.asyncEnd!.publish(event);
        return resolved;
      },
      (error) => {
        event.error = normalizeError(error);
        tracingChannel.error!.publish(event);
        throw error;
      },
    );
  }

  event.result = result;
  tracingChannel.asyncEnd!.publish(event);
  return result;
}

function getToolCallId(context: unknown): string | undefined {
  const toolContext = context as OpenRouterToolTurnContext | undefined;
  return typeof toolContext?.toolCall?.id === "string"
    ? toolContext.toolCall.id
    : undefined;
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

function startOpenRouterCallModelTurnSpan(args: {
  request: OpenRouterCallModelRequest | Record<string, unknown> | undefined;
  step: number;
  stepType: "initial" | "continue";
}): Span {
  const requestRecord = isObject(args.request)
    ? (args.request as OpenRouterCallModelRequest)
    : undefined;
  const metadata = requestRecord
    ? extractOpenRouterCallModelMetadata(requestRecord)
    : { provider: "openrouter" };
  if (isObject(metadata) && "tools" in metadata) {
    delete (metadata as Record<string, unknown>).tools;
  }

  return startSpan({
    name: "openrouter.beta.responses.send",
    spanAttributes: {
      type: SpanTypeAttribute.LLM,
    },
    event: {
      input: requestRecord
        ? extractOpenRouterCallModelInput(requestRecord)
        : undefined,
      metadata: {
        ...metadata,
        step: args.step,
        step_type: args.stepType,
      },
    },
  });
}

function finishOpenRouterCallModelTurnSpan(args: {
  response: unknown;
  step?: number;
  stepType?: "initial" | "continue";
  span: Span;
}) {
  if (!isObject(args.response)) {
    args.span.end();
    return;
  }

  args.span.log({
    output: extractOpenRouterResponseOutput(args.response),
    ...(extractOpenRouterResponseMetadata(args.response)
      ? {
          metadata: {
            ...extractOpenRouterResponseMetadata(args.response),
            ...(args.step !== undefined ? { step: args.step } : {}),
            ...(args.stepType ? { step_type: args.stepType } : {}),
          },
        }
      : {}),
    metrics: parseOpenRouterMetricsFromUsage(args.response.usage),
  });
  args.span.end();
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
