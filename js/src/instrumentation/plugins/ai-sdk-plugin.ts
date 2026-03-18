import { BasePlugin } from "../core";
import {
  traceStreamingChannel,
  traceSyncStreamChannel,
  unsubscribeAll,
} from "../core/channel-tracing";
import { SpanTypeAttribute } from "../../../util/index";
import { getCurrentUnixTimestamp } from "../../util";
import { type Span, withCurrent } from "../../logger";
import { processInputAttachments } from "../../wrappers/attachment-utils";
import { normalizeAISDKLoggedOutput } from "../../wrappers/ai-sdk/normalize-logged-output";
import { serializeAISDKToolsForLogging } from "../../wrappers/ai-sdk/tool-serialization";
import { aiSDKChannels } from "./ai-sdk-channels";
import type {
  AISDKCallParams,
  AISDKLanguageModel,
  AISDKModel,
  AISDKModelStreamChunk,
  AISDKResult,
  AISDKTool,
  AISDKTools,
  AISDKUsage,
} from "../../vendor-sdk-types/ai-sdk";

export interface AISDKPluginConfig {
  /**
   * List of JSON paths to remove from output field.
   * Uses dot notation with array wildcards: "roundtrips[].request.body"
   */
  denyOutputPaths?: string[];
}

/**
 * Default paths to omit from AI SDK output logging.
 * These contain redundant or verbose data that's not useful for tracing.
 */
const DEFAULT_DENY_OUTPUT_PATHS: string[] = [
  // v3
  "roundtrips[].request.body",
  "roundtrips[].response.headers",
  "rawResponse.headers",
  "responseMessages",
  // v5
  "request.body",
  "response.body",
  "response.headers",
  "steps[].request.body",
  "steps[].response.body",
  "steps[].response.headers",
];

const AUTO_PATCHED_MODEL = Symbol.for("braintrust.ai-sdk.auto-patched-model");
const AUTO_PATCHED_TOOL = Symbol.for("braintrust.ai-sdk.auto-patched-tool");

/**
 * AI SDK plugin that subscribes to instrumentation channels
 * and creates Braintrust spans.
 *
 * This plugin handles:
 * - generateText (async function)
 * - streamText (async function returning stream)
 * - generateObject (async function)
 * - streamObject (async function returning stream)
 * - Agent.generate (async method)
 * - Agent.stream (async method returning stream)
 * - ToolLoopAgent.generate (async method)
 * - ToolLoopAgent.stream (async method returning stream)
 *
 * The plugin automatically extracts:
 * - Model and provider information
 * - Token usage metrics
 * - Tool calls and structured outputs
 * - Streaming responses with time-to-first-token
 */
export class AISDKPlugin extends BasePlugin {
  private config: AISDKPluginConfig;

  constructor(config: AISDKPluginConfig = {}) {
    super();
    this.config = config;
  }

  protected onEnable(): void {
    this.subscribeToAISDK();
  }

  protected onDisable(): void {
    this.unsubscribers = unsubscribeAll(this.unsubscribers);
  }

  private subscribeToAISDK(): void {
    const denyOutputPaths =
      this.config.denyOutputPaths || DEFAULT_DENY_OUTPUT_PATHS;

    // generateText - async function that may return streams
    this.unsubscribers.push(
      traceStreamingChannel(aiSDKChannels.generateText, {
        name: "generateText",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        extractOutput: (result, endEvent) => {
          finalizeAISDKChildTracing(endEvent as { [key: string]: unknown });
          return processAISDKOutput(result, denyOutputPaths);
        },
        extractMetrics: (result, _startTime, endEvent) =>
          extractTopLevelAISDKMetrics(result, endEvent),
        aggregateChunks: aggregateAISDKChunks,
      }),
    );

    // streamText - async function returning stream
    this.unsubscribers.push(
      traceStreamingChannel(aiSDKChannels.streamText, {
        name: "streamText",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        extractOutput: (result) => processAISDKOutput(result, denyOutputPaths),
        extractMetrics: (result, startTime, endEvent) =>
          extractTopLevelAISDKMetrics(result, endEvent, startTime),
        aggregateChunks: aggregateAISDKChunks,
        patchResult: ({ endEvent, result, span, startTime }) =>
          patchAISDKStreamingResult({
            denyOutputPaths,
            endEvent,
            result,
            span,
            startTime,
          }),
      }),
    );

    // streamText - sync function returning stream (CommonJS bundle)
    this.unsubscribers.push(
      traceSyncStreamChannel(aiSDKChannels.streamTextSync, {
        name: "streamText",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        patchResult: ({ endEvent, result, span, startTime }) =>
          patchAISDKStreamingResult({
            denyOutputPaths,
            endEvent,
            result,
            span,
            startTime,
          }),
      }),
    );

    // generateObject - async function that may return streams
    this.unsubscribers.push(
      traceStreamingChannel(aiSDKChannels.generateObject, {
        name: "generateObject",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        extractOutput: (result, endEvent) => {
          finalizeAISDKChildTracing(endEvent as { [key: string]: unknown });
          return processAISDKOutput(result, denyOutputPaths);
        },
        extractMetrics: (result, _startTime, endEvent) =>
          extractTopLevelAISDKMetrics(result, endEvent),
        aggregateChunks: aggregateAISDKChunks,
      }),
    );

    // streamObject - async function returning stream
    this.unsubscribers.push(
      traceStreamingChannel(aiSDKChannels.streamObject, {
        name: "streamObject",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        extractOutput: (result) => processAISDKOutput(result, denyOutputPaths),
        extractMetrics: (result, startTime, endEvent) =>
          extractTopLevelAISDKMetrics(result, endEvent, startTime),
        aggregateChunks: aggregateAISDKChunks,
        patchResult: ({ endEvent, result, span, startTime }) =>
          patchAISDKStreamingResult({
            denyOutputPaths,
            endEvent,
            result,
            span,
            startTime,
          }),
      }),
    );

    // streamObject - sync function returning stream (CommonJS bundle)
    this.unsubscribers.push(
      traceSyncStreamChannel(aiSDKChannels.streamObjectSync, {
        name: "streamObject",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        patchResult: ({ endEvent, result, span, startTime }) =>
          patchAISDKStreamingResult({
            denyOutputPaths,
            endEvent,
            result,
            span,
            startTime,
          }),
      }),
    );

    // Agent.generate - async method
    this.unsubscribers.push(
      traceStreamingChannel(aiSDKChannels.agentGenerate, {
        name: "Agent.generate",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        extractOutput: (result, endEvent) => {
          finalizeAISDKChildTracing(endEvent as { [key: string]: unknown });
          return processAISDKOutput(result, denyOutputPaths);
        },
        extractMetrics: (result, _startTime, endEvent) =>
          extractTopLevelAISDKMetrics(result, endEvent),
        aggregateChunks: aggregateAISDKChunks,
      }),
    );

    // Agent.stream - async method returning stream
    this.unsubscribers.push(
      traceStreamingChannel(aiSDKChannels.agentStream, {
        name: "Agent.stream",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        extractOutput: (result) => processAISDKOutput(result, denyOutputPaths),
        extractMetrics: (result, startTime, endEvent) =>
          extractTopLevelAISDKMetrics(result, endEvent, startTime),
        aggregateChunks: aggregateAISDKChunks,
        patchResult: ({ endEvent, result, span, startTime }) =>
          patchAISDKStreamingResult({
            denyOutputPaths,
            endEvent,
            result,
            span,
            startTime,
          }),
      }),
    );

    // ToolLoopAgent.generate - async method
    this.unsubscribers.push(
      traceStreamingChannel(aiSDKChannels.toolLoopAgentGenerate, {
        name: "ToolLoopAgent.generate",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        extractOutput: (result, endEvent) => {
          finalizeAISDKChildTracing(endEvent as { [key: string]: unknown });
          return processAISDKOutput(result, denyOutputPaths);
        },
        extractMetrics: (result, _startTime, endEvent) =>
          extractTopLevelAISDKMetrics(result, endEvent),
        aggregateChunks: aggregateAISDKChunks,
      }),
    );

    // ToolLoopAgent.stream - async method returning stream
    this.unsubscribers.push(
      traceStreamingChannel(aiSDKChannels.toolLoopAgentStream, {
        name: "ToolLoopAgent.stream",
        type: SpanTypeAttribute.LLM,
        extractInput: ([params], event, span) =>
          prepareAISDKInput(params, event, span, denyOutputPaths),
        extractOutput: (result) => processAISDKOutput(result, denyOutputPaths),
        extractMetrics: (result, startTime, endEvent) =>
          extractTopLevelAISDKMetrics(result, endEvent, startTime),
        aggregateChunks: aggregateAISDKChunks,
        patchResult: ({ endEvent, result, span, startTime }) =>
          patchAISDKStreamingResult({
            denyOutputPaths,
            endEvent,
            result,
            span,
            startTime,
          }),
      }),
    );
  }
}

/**
 * Process AI SDK input parameters, converting attachments as needed.
 */
function processAISDKInput(params: AISDKCallParams): unknown {
  if (!params) return params;

  // Use the attachment processing from the manual wrapper, but keep tool
  // definitions in metadata to match the OpenAI wrapper convention.
  const input = processInputAttachments(params);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const { tools: _tools, ...rest } = input as Record<string, unknown>;
  return rest;
}

function prepareAISDKInput(
  params: AISDKCallParams,
  event: { self?: unknown; [key: string]: unknown },
  span: Span,
  denyOutputPaths: string[],
): {
  input: unknown;
  metadata: Record<string, unknown>;
} {
  const input = processAISDKInput(params);
  const metadata = extractMetadataFromParams(params, event.self);
  const childTracing = prepareAISDKChildTracing(
    params,
    event.self,
    span,
    denyOutputPaths,
  );
  event.__braintrust_ai_sdk_model_wrapped = childTracing.modelWrapped;
  if (childTracing.cleanup) {
    event.__braintrust_ai_sdk_cleanup = childTracing.cleanup;
  }

  return {
    input,
    metadata,
  };
}

function extractTopLevelAISDKMetrics(
  result: AISDKResult,
  event?: { [key: string]: unknown },
  startTime?: number,
): Record<string, number> {
  const metrics = hasModelChildTracing(event)
    ? {}
    : extractTokenMetrics(result);

  if (startTime) {
    metrics.time_to_first_token = getCurrentUnixTimestamp() - startTime;
  }

  return metrics;
}

function hasModelChildTracing(event?: { [key: string]: unknown }): boolean {
  return event?.__braintrust_ai_sdk_model_wrapped === true;
}

/**
 * Extract metadata from AI SDK parameters.
 * Includes model, provider, and integration info.
 */
function extractMetadataFromParams(
  params: AISDKCallParams,
  self?: unknown,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    braintrust: {
      integration_name: "ai-sdk",
      sdk_language: "typescript",
    },
  };

  // Extract model information
  const agentModel =
    self &&
    typeof self === "object" &&
    "model" in self &&
    (self as { model?: AISDKModel }).model
      ? (self as { model?: AISDKModel }).model
      : self &&
          typeof self === "object" &&
          "settings" in self &&
          (self as { settings?: { model?: AISDKModel } }).settings?.model
        ? (self as { settings?: { model?: AISDKModel } }).settings?.model
        : undefined;
  const { model, provider } = serializeModelWithProvider(
    params.model ?? agentModel,
  );
  if (model) {
    metadata.model = model;
  }
  if (provider) {
    metadata.provider = provider;
  }
  const tools = serializeAISDKToolsForLogging(params.tools);
  if (tools) {
    metadata.tools = tools;
  }

  return metadata;
}

function prepareAISDKChildTracing(
  params: AISDKCallParams,
  self: unknown,
  parentSpan: Span,
  denyOutputPaths: string[],
): {
  cleanup?: () => void;
  modelWrapped: boolean;
} {
  const cleanup: Array<() => void> = [];
  const patchedModels = new WeakSet<object>();
  const patchedTools = new WeakSet<object>();
  let modelWrapped = false;

  const patchModel = (model: AISDKModel | undefined): void => {
    const resolvedModel = resolveAISDKModel(model);
    if (
      !resolvedModel ||
      typeof resolvedModel !== "object" ||
      typeof resolvedModel.doGenerate !== "function" ||
      patchedModels.has(resolvedModel) ||
      (resolvedModel as { [AUTO_PATCHED_MODEL]?: boolean })[AUTO_PATCHED_MODEL]
    ) {
      return;
    }

    patchedModels.add(resolvedModel);
    (resolvedModel as { [AUTO_PATCHED_MODEL]?: boolean })[AUTO_PATCHED_MODEL] =
      true;
    modelWrapped = true;

    const originalDoGenerate = resolvedModel.doGenerate;
    const originalDoStream = resolvedModel.doStream;
    const baseMetadata = buildAISDKChildMetadata(resolvedModel);

    resolvedModel.doGenerate = async function doGeneratePatched(
      options: AISDKCallParams,
    ) {
      return parentSpan.traced(
        async (span) => {
          const result = await Reflect.apply(
            originalDoGenerate,
            resolvedModel,
            [options],
          );

          span.log({
            output: processAISDKOutput(result, denyOutputPaths),
            metrics: extractTokenMetrics(result),
            ...buildResolvedMetadataPayload(result),
          });

          return result;
        },
        {
          name: "doGenerate",
          spanAttributes: {
            type: SpanTypeAttribute.LLM,
          },
          event: {
            input: processAISDKInput(options),
            metadata: baseMetadata,
          },
        },
      );
    };

    if (originalDoStream) {
      resolvedModel.doStream = async function doStreamPatched(
        options: AISDKCallParams,
      ) {
        const span = parentSpan.startSpan({
          name: "doStream",
          spanAttributes: {
            type: SpanTypeAttribute.LLM,
          },
          event: {
            input: processAISDKInput(options),
            metadata: baseMetadata,
          },
        });

        const result = await withCurrent(span, () =>
          Reflect.apply(originalDoStream, resolvedModel, [options]),
        );
        const output: Record<string, unknown> = {};
        let text = "";
        let reasoning = "";
        const toolCalls: unknown[] = [];
        let object: unknown = undefined;

        const transformStream = new TransformStream({
          transform(chunk: AISDKModelStreamChunk, controller) {
            switch (chunk.type) {
              case "text-delta":
                text += extractTextDelta(chunk);
                break;
              case "reasoning-delta":
                if (chunk.delta) {
                  reasoning += chunk.delta;
                } else if (chunk.text) {
                  reasoning += chunk.text;
                }
                break;
              case "tool-call":
                toolCalls.push(chunk);
                break;
              case "object":
                object = chunk.object;
                break;
              case "raw":
                if (chunk.rawValue) {
                  const rawVal = chunk.rawValue as {
                    choices?: Array<{ delta?: { content?: string } }>;
                    content?: string;
                    delta?: { content?: string };
                    text?: string;
                  };
                  if (rawVal.delta?.content) {
                    text += rawVal.delta.content;
                  } else if (rawVal.choices?.[0]?.delta?.content) {
                    text += rawVal.choices[0].delta.content;
                  } else if (typeof rawVal.text === "string") {
                    text += rawVal.text;
                  } else if (typeof rawVal.content === "string") {
                    text += rawVal.content;
                  }
                }
                break;
              case "finish":
                output.text = text;
                output.reasoning = reasoning;
                output.toolCalls = toolCalls;
                output.finishReason = chunk.finishReason;
                output.usage = chunk.usage;

                if (object !== undefined) {
                  output.object = object;
                }

                span.log({
                  output: processAISDKOutput(
                    output as AISDKResult,
                    denyOutputPaths,
                  ),
                  metrics: extractTokenMetrics(output as AISDKResult),
                  ...buildResolvedMetadataPayload(output as AISDKResult),
                });
                span.end();
                break;
            }
            controller.enqueue(chunk);
          },
        });

        return {
          ...result,
          stream: result.stream.pipeThrough(transformStream),
        };
      };
    }

    cleanup.push(() => {
      resolvedModel.doGenerate = originalDoGenerate;
      if (originalDoStream) {
        resolvedModel.doStream = originalDoStream;
      }
      delete (resolvedModel as { [AUTO_PATCHED_MODEL]?: boolean })[
        AUTO_PATCHED_MODEL
      ];
    });
  };

  const patchTool = (tool: AISDKTool, name: string): void => {
    if (
      tool == null ||
      typeof tool !== "object" ||
      !("execute" in tool) ||
      typeof tool.execute !== "function" ||
      patchedTools.has(tool) ||
      (tool as { [AUTO_PATCHED_TOOL]?: boolean })[AUTO_PATCHED_TOOL]
    ) {
      return;
    }

    patchedTools.add(tool);
    (tool as { [AUTO_PATCHED_TOOL]?: boolean })[AUTO_PATCHED_TOOL] = true;
    const originalExecute = tool.execute;
    tool.execute = function executePatched(...args: unknown[]) {
      const result = Reflect.apply(originalExecute, this, args);

      if (isAsyncGenerator(result)) {
        return (async function* () {
          const span = parentSpan.startSpan({
            name,
            spanAttributes: {
              type: SpanTypeAttribute.TOOL,
            },
          });
          span.log({ input: args.length === 1 ? args[0] : args });

          try {
            let lastValue: unknown;
            for await (const value of result) {
              lastValue = value;
              yield value;
            }
            span.log({ output: lastValue });
          } catch (error) {
            span.log({
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            span.end();
          }
        })();
      }

      return parentSpan.traced(
        async (span) => {
          span.log({ input: args.length === 1 ? args[0] : args });
          const awaitedResult = await result;
          span.log({ output: awaitedResult });
          return awaitedResult;
        },
        {
          name,
          spanAttributes: {
            type: SpanTypeAttribute.TOOL,
          },
        },
      );
    };

    cleanup.push(() => {
      tool.execute = originalExecute;
      delete (tool as { [AUTO_PATCHED_TOOL]?: boolean })[AUTO_PATCHED_TOOL];
    });
  };

  const patchTools = (tools: AISDKTools | undefined): void => {
    if (!tools) {
      return;
    }

    const inferName = (tool: AISDKTool, fallback: string) =>
      (tool && (tool.name || tool.toolName || tool.id)) || fallback;

    if (Array.isArray(tools)) {
      tools.forEach((tool, index) =>
        patchTool(tool, inferName(tool, `tool[${index}]`)),
      );
      return;
    }

    for (const [key, tool] of Object.entries(tools)) {
      patchTool(tool, key);
    }
  };

  if (params && typeof params === "object") {
    patchModel(params.model);
    patchTools(params.tools);
  }

  if (self && typeof self === "object") {
    const selfRecord = self as {
      model?: AISDKModel;
      settings?: { model?: AISDKModel; tools?: AISDKTools };
    };

    if (selfRecord.model !== undefined) {
      patchModel(selfRecord.model);
    }

    if (selfRecord.settings && typeof selfRecord.settings === "object") {
      if (selfRecord.settings.model !== undefined) {
        patchModel(selfRecord.settings.model);
      }
      if (selfRecord.settings.tools !== undefined) {
        patchTools(selfRecord.settings.tools);
      }
    }
  }

  return {
    cleanup:
      cleanup.length > 0
        ? () => {
            while (cleanup.length > 0) {
              cleanup.pop()?.();
            }
          }
        : undefined,
    modelWrapped,
  };
}

function finalizeAISDKChildTracing(event?: { [key: string]: unknown }): void {
  const cleanup = event?.__braintrust_ai_sdk_cleanup;
  if (event && typeof cleanup === "function") {
    cleanup();
    delete event.__braintrust_ai_sdk_cleanup;
  }
}

function patchAISDKStreamingResult(args: {
  denyOutputPaths: string[];
  endEvent: { [key: string]: unknown };
  result: AISDKResult;
  span: Span;
  startTime: number;
}): boolean {
  const { denyOutputPaths, endEvent, result, span, startTime } = args;

  if (!result || typeof result !== "object") {
    return false;
  }

  const resultRecord = result as Record<string, unknown>;
  if (!isReadableStreamLike(resultRecord.baseStream)) {
    return false;
  }

  let firstChunkTime: number | undefined;

  const wrappedBaseStream = resultRecord.baseStream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (firstChunkTime === undefined) {
          firstChunkTime = getCurrentUnixTimestamp();
        }
        controller.enqueue(chunk);
      },
      async flush() {
        const metrics = extractTopLevelAISDKMetrics(result, endEvent);
        if (
          metrics.time_to_first_token === undefined &&
          firstChunkTime !== undefined
        ) {
          metrics.time_to_first_token = firstChunkTime - startTime;
        }

        const output = await processAISDKStreamingOutput(
          result,
          denyOutputPaths,
        );
        const metadata = buildResolvedMetadataPayload(result).metadata;

        span.log({
          output,
          ...(metadata ? { metadata } : {}),
          metrics,
        });

        finalizeAISDKChildTracing(endEvent);
        span.end();
      },
    }),
  );

  Object.defineProperty(resultRecord, "baseStream", {
    configurable: true,
    enumerable: true,
    value: wrappedBaseStream,
    writable: true,
  });

  return true;
}

function isReadableStreamLike(value: unknown): value is {
  pipeThrough<T>(transform: TransformStream<unknown, T>): ReadableStream<T>;
} {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { pipeThrough?: unknown }).pipeThrough === "function"
  );
}

async function processAISDKStreamingOutput(
  result: AISDKResult,
  denyOutputPaths: string[],
): Promise<Record<string, unknown> | AISDKResult> {
  const output = processAISDKOutput(result, denyOutputPaths);

  if (!output || typeof output !== "object") {
    return output;
  }

  const outputRecord = output as Record<string, unknown>;

  try {
    if ("text" in result && typeof result.text === "string") {
      outputRecord.text = result.text;
    }
  } catch {
    // Ignore getter failures
  }

  try {
    if ("object" in result) {
      const resolvedObject = await Promise.resolve(result.object);
      if (resolvedObject !== undefined) {
        outputRecord.object = resolvedObject;
      }
    }
  } catch {
    // Ignore getter/promise failures
  }

  return outputRecord;
}

function buildAISDKChildMetadata(
  model: AISDKModel | undefined,
): Record<string, unknown> {
  const { model: modelId, provider } = serializeModelWithProvider(model);

  return {
    ...(modelId ? { model: modelId } : {}),
    ...(provider ? { provider } : {}),
    braintrust: {
      integration_name: "ai-sdk",
      sdk_language: "typescript",
    },
  };
}

function buildResolvedMetadataPayload(result: AISDKResult): {
  metadata?: Record<string, unknown>;
} {
  const gatewayInfo = extractGatewayRoutingInfo(result);
  const metadata: Record<string, unknown> = {};

  if (gatewayInfo?.provider) {
    metadata.provider = gatewayInfo.provider;
  }
  if (gatewayInfo?.model) {
    metadata.model = gatewayInfo.model;
  }
  if (result.finishReason !== undefined) {
    metadata.finish_reason = result.finishReason;
  }

  return Object.keys(metadata).length > 0 ? { metadata } : {};
}

function resolveAISDKModel(
  model: AISDKModel | undefined,
): AISDKModel | undefined {
  if (typeof model !== "string") {
    return model;
  }

  const provider =
    (
      globalThis as typeof globalThis & {
        AI_SDK_DEFAULT_PROVIDER?: {
          languageModel?: (modelId: string) => AISDKLanguageModel;
        };
      }
    ).AI_SDK_DEFAULT_PROVIDER ?? null;

  if (provider && typeof provider.languageModel === "function") {
    return provider.languageModel(model);
  }

  return model;
}

function extractTextDelta(chunk: AISDKModelStreamChunk): string {
  if (typeof chunk.textDelta === "string") return chunk.textDelta;
  if (typeof chunk.delta === "string") return chunk.delta;
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.content === "string") return chunk.content;
  return "";
}

function isAsyncGenerator(value: unknown): value is AsyncGenerator {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as AsyncGenerator)[Symbol.asyncIterator] === "function" &&
    typeof (value as AsyncGenerator).next === "function" &&
    typeof (value as AsyncGenerator).return === "function" &&
    typeof (value as AsyncGenerator).throw === "function"
  );
}

/**
 * Process AI SDK output, omitting specified paths.
 */
function processAISDKOutput(
  output: AISDKResult,
  denyOutputPaths: string[],
): Record<string, unknown> | AISDKResult {
  if (!output) return output;

  const merged = extractSerializableOutputFields(output);

  // Apply omit to remove unwanted paths
  return normalizeAISDKLoggedOutput(omit(merged, denyOutputPaths));
}

/**
 * Extract token metrics from AI SDK result.
 */
function extractTokenMetrics(result: AISDKResult): Record<string, number> {
  const metrics: Record<string, number> = {};

  // Agent results use totalUsage, other results use usage
  let usage: AISDKUsage | undefined = result?.totalUsage || result?.usage;

  // Try as getter if not directly accessible
  if (!usage && result) {
    try {
      if ("totalUsage" in result && typeof result.totalUsage !== "function") {
        usage = result.totalUsage;
      } else if ("usage" in result && typeof result.usage !== "function") {
        usage = result.usage;
      }
    } catch {
      // Ignore errors accessing getters
    }
  }

  if (!usage) {
    return metrics;
  }

  // Extract token counts
  const promptTokens = firstNumber(
    usage.inputTokens?.total,
    usage.inputTokens,
    usage.promptTokens,
    usage.prompt_tokens,
  );
  if (promptTokens !== undefined) {
    metrics.prompt_tokens = promptTokens;
  }

  const completionTokens = firstNumber(
    usage.outputTokens?.total,
    usage.outputTokens,
    usage.completionTokens,
    usage.completion_tokens,
  );
  if (completionTokens !== undefined) {
    metrics.completion_tokens = completionTokens;
  }

  const totalTokens = firstNumber(
    usage.totalTokens,
    usage.tokens,
    usage.total_tokens,
  );
  if (totalTokens !== undefined) {
    metrics.tokens = totalTokens;
  }

  // Extract cost from gateway routing if available
  const cost = extractCostFromResult(result);
  if (cost !== undefined) {
    metrics.estimated_cost = cost;
  }

  return metrics;
}

/**
 * Aggregate AI SDK streaming chunks into a single response.
 */
function aggregateAISDKChunks(
  chunks: unknown[],
  _result?: AISDKResult | AsyncIterable<unknown>,
  endEvent?: { [key: string]: unknown },
): {
  output: Record<string, unknown>;
  metrics: Record<string, number>;
  metadata?: Record<string, unknown>;
} {
  // For AI SDK streams, the chunks are typically delta objects
  // We'll return the last chunk which usually contains the final state
  const lastChunk = chunks[chunks.length - 1] as AISDKResult | undefined;

  const output: Record<string, unknown> = {};
  let metrics: Record<string, number> = {};
  let metadata: Record<string, unknown> | undefined;

  // Extract usage from last chunk
  if (lastChunk) {
    metrics = hasModelChildTracing(endEvent)
      ? {}
      : extractTokenMetrics(lastChunk);
    metadata = buildResolvedMetadataPayload(lastChunk).metadata;

    // Extract common output fields
    if (lastChunk.text !== undefined) {
      output.text = lastChunk.text;
    }
    if (lastChunk.object !== undefined) {
      output.object = lastChunk.object;
    }
    if (lastChunk.finishReason !== undefined) {
      output.finishReason = lastChunk.finishReason;
    }
    if (lastChunk.toolCalls !== undefined) {
      output.toolCalls = lastChunk.toolCalls;
    }
  }

  finalizeAISDKChildTracing(endEvent);

  return { output, metrics, metadata };
}

/**
 * Extract getter values from AI SDK result objects.
 */
function extractGetterValues(
  obj: AISDKResult,
): Partial<Record<string, unknown>> {
  const getterValues: Record<string, unknown> = {};

  const getterNames = [
    "text",
    "object",
    "finishReason",
    "usage",
    "totalUsage",
    "toolCalls",
    "toolResults",
    "warnings",
    "experimental_providerMetadata",
    "providerMetadata",
    "rawResponse",
    "response",
  ];

  for (const name of getterNames) {
    try {
      if (obj && name in obj && isSerializableOutputValue(obj[name])) {
        getterValues[name] = obj[name];
      }
    } catch {
      // Ignore errors accessing getters
    }
  }

  return getterValues;
}

function extractSerializableOutputFields(
  output: AISDKResult,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  const directFieldNames = [
    "steps",
    "request",
    "responseMessages",
    "warnings",
    "rawResponse",
    "response",
    "providerMetadata",
    "experimental_providerMetadata",
  ] as const;

  for (const name of directFieldNames) {
    try {
      const value = output?.[name];
      if (isSerializableOutputValue(value)) {
        serialized[name] = value;
      }
    } catch {
      // Ignore errors accessing getters
    }
  }

  return {
    ...serialized,
    ...extractGetterValues(output),
  };
}

function isSerializableOutputValue(value: unknown): boolean {
  if (typeof value === "function") {
    return false;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  ) {
    return false;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { getReader?: unknown }).getReader === "function"
  ) {
    return false;
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === "function"
  ) {
    return false;
  }

  return true;
}

/**
 * Extracts model ID and provider from a model object or string.
 */
function serializeModelWithProvider(model: AISDKModel | undefined): {
  model: string | undefined;
  provider?: string;
} {
  const modelId = typeof model === "string" ? model : model?.modelId;
  const explicitProvider =
    typeof model === "object" ? model?.provider : undefined;

  if (!modelId) {
    return { model: modelId, provider: explicitProvider };
  }

  // Parse gateway-style model strings like "openai/gpt-4"
  const parsed = parseGatewayModelString(modelId);
  return {
    model: parsed.model,
    provider: explicitProvider || parsed.provider,
  };
}

/**
 * Parse gateway model string like "openai/gpt-4" into provider and model.
 */
function parseGatewayModelString(modelString: string): {
  model: string;
  provider?: string;
} {
  if (!modelString || typeof modelString !== "string") {
    return { model: modelString };
  }
  const slashIndex = modelString.indexOf("/");
  if (slashIndex > 0 && slashIndex < modelString.length - 1) {
    return {
      provider: modelString.substring(0, slashIndex),
      model: modelString.substring(slashIndex + 1),
    };
  }
  return { model: modelString };
}

function extractGatewayRoutingInfo(result: AISDKResult): {
  model?: string;
  provider?: string;
} | null {
  if (result?.steps && Array.isArray(result.steps) && result.steps.length > 0) {
    const routing = result.steps[0]?.providerMetadata?.gateway?.routing;
    if (routing) {
      return {
        provider: routing.resolvedProvider || routing.finalProvider,
        model: routing.resolvedProviderApiModelId,
      };
    }
  }

  const routing = result?.providerMetadata?.gateway?.routing;
  if (routing) {
    return {
      provider: routing.resolvedProvider || routing.finalProvider,
      model: routing.resolvedProviderApiModelId,
    };
  }

  return null;
}

/**
 * Extract cost from result's providerMetadata.
 */
function extractCostFromResult(result: AISDKResult): number | undefined {
  // Check for cost in steps (multi-step results)
  if (result?.steps && Array.isArray(result.steps) && result.steps.length > 0) {
    let totalCost = 0;
    let foundCost = false;
    for (const step of result.steps) {
      const gateway = step?.providerMetadata?.gateway;
      const stepCost =
        parseGatewayCost(gateway?.cost) ||
        parseGatewayCost(gateway?.marketCost);
      if (stepCost !== undefined && stepCost > 0) {
        totalCost += stepCost;
        foundCost = true;
      }
    }
    if (foundCost) {
      return totalCost;
    }
  }

  // Check direct providerMetadata
  const gateway = result?.providerMetadata?.gateway;
  const directCost =
    parseGatewayCost(gateway?.cost) || parseGatewayCost(gateway?.marketCost);
  if (directCost !== undefined && directCost > 0) {
    return directCost;
  }

  return undefined;
}

/**
 * Parse gateway cost value.
 */
function parseGatewayCost(cost: unknown): number | undefined {
  if (cost === undefined || cost === null) {
    return undefined;
  }
  if (typeof cost === "number") {
    return cost;
  }
  if (typeof cost === "string") {
    const parsed = parseFloat(cost);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Get first number from a list of values.
 */
function firstNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === "number") {
      return v;
    }
  }
  return undefined;
}

/**
 * Deep copy an object via JSON serialization.
 */
function deepCopy(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Parse a JSON path string into an array of keys.
 */
function parsePath(path: string): (string | number)[] {
  const keys: (string | number)[] = [];
  let current = "";

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (char === ".") {
      if (current) {
        keys.push(current);
        current = "";
      }
    } else if (char === "[") {
      if (current) {
        keys.push(current);
        current = "";
      }
      let bracketContent = "";
      i++;
      while (i < path.length && path[i] !== "]") {
        bracketContent += path[i];
        i++;
      }
      if (bracketContent === "") {
        keys.push("[]");
      } else {
        const index = parseInt(bracketContent, 10);
        keys.push(isNaN(index) ? bracketContent : index);
      }
    } else {
      current += char;
    }
  }

  if (current) {
    keys.push(current);
  }

  return keys;
}

/**
 * Omit a value at a specific path in an object.
 */
function omitAtPath(
  obj: Record<string, unknown> | unknown[] | undefined,
  keys: (string | number)[],
): void {
  if (keys.length === 0) return;

  const firstKey = keys[0];
  const remainingKeys = keys.slice(1);

  if (firstKey === "[]") {
    if (Array.isArray(obj)) {
      obj.forEach((item) => {
        if (remainingKeys.length > 0) {
          omitAtPath(
            item as Record<string, unknown> | unknown[] | undefined,
            remainingKeys,
          );
        }
      });
    }
  } else if (remainingKeys.length === 0) {
    if (obj && typeof obj === "object" && firstKey in obj) {
      (obj as Record<string | number, unknown>)[firstKey] = "<omitted>";
    }
  } else {
    if (obj && typeof obj === "object" && firstKey in obj) {
      omitAtPath(
        (obj as Record<string | number, unknown>)[firstKey] as
          | Record<string, unknown>
          | unknown[]
          | undefined,
        remainingKeys,
      );
    }
  }
}

/**
 * Omit specified paths from an object.
 */
function omit(
  obj: Record<string, unknown>,
  paths: string[],
): Record<string, unknown> {
  const result = deepCopy(obj);

  for (const path of paths) {
    const keys = parsePath(path);
    omitAtPath(result, keys);
  }

  return result;
}
