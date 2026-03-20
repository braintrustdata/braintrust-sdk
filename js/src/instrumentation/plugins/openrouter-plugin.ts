import { BasePlugin } from "../core";
import {
  traceAsyncChannel,
  traceStreamingChannel,
  traceSyncStreamChannel,
  unsubscribeAll,
} from "../core/channel-tracing";
import { SpanTypeAttribute, isObject } from "../../../util/index";
import { getCurrentUnixTimestamp } from "../../util";
import {
  patchOpenRouterCallModelRequestTools,
  patchOpenRouterCallModelResult,
} from "../../openrouter-tool-wrapping";
import {
  buildOpenRouterEmbeddingMetadata,
  buildOpenRouterMetadata,
  extractOpenRouterCallModelInput,
  extractOpenRouterCallModelMetadata,
  extractOpenRouterResponseMetadata,
  extractOpenRouterResponseOutput,
} from "../../openrouter-logging";
import { parseOpenRouterMetricsFromUsage } from "../../openrouter-utils";
import { openRouterChannels } from "./openrouter-channels";
import type {
  OpenRouterChatChoice,
  OpenRouterChatCompletionChunk,
  OpenRouterCallModelRequest,
  OpenRouterEmbeddingResponse,
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
          return patchOpenRouterCallModelResult(
            span,
            result,
            getOpenRouterCallModelRequestArg(endEvent.arguments),
          );
        },
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

export { parseOpenRouterMetricsFromUsage };
