import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type { ChannelSpanInfo } from "../core/types";
import type {
  AISDK,
  AISDKEvaluateParams,
  AISDKEvaluationResult,
  AISDKCallParams,
  AISDKEmbedParams,
  AISDKEmbeddingResult,
  AISDKGenerateImageParams,
  AISDKHarnessAgentCallParams,
  AISDKHarnessAgentCreateSessionParams,
  AISDKHarnessAgentSession,
  AISDKLanguageModel,
  AISDKModelStreamChunk,
  AISDKRerankParams,
  AISDKRerankResult,
  AISDKResult,
} from "../../vendor-sdk-types/ai-sdk";
import type {
  AISDKV7CreateTelemetryDispatcherArgs,
  AISDKV7TelemetryDispatcher,
} from "../../vendor-sdk-types/ai-sdk-v7-telemetry";

type AISDKStreamResult = AISDKResult | AsyncIterable<unknown>;
type AISDKChannelContext = {
  aiSDK?: AISDK;
  denyOutputPaths?: string[];
  self?: unknown;
  span_info?: ChannelSpanInfo;
};

type AISDKModelChannelContext = {
  denyOutputPaths?: string[];
  model: AISDKLanguageModel;
};

export const BRAINTRUST_WRAPPED_AI_SDK_MODEL: symbol = /* @__PURE__ */ (() =>
  Symbol.for("braintrust.ai-sdk.wrapped-model"))();

export const aiSDKChannels: {
  modelGenerate: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKResult,
      AISDKModelChannelContext,
      never,
      "async"
    >
  >;
  modelStream: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKResult & { stream: ReadableStream<AISDKModelStreamChunk> },
      AISDKModelChannelContext,
      never,
      "async"
    >
  >;
  evaluate: MaterializedChannel<
    ChannelSpec<
      [AISDKEvaluateParams],
      AISDKEvaluationResult,
      AISDKChannelContext,
      never,
      "async"
    >
  >;
  generateText: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  generateImage: MaterializedChannel<
    ChannelSpec<
      [AISDKGenerateImageParams],
      AISDKResult,
      AISDKChannelContext,
      never,
      "async"
    >
  >;
  streamTextSync: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKResult,
      AISDKChannelContext,
      unknown,
      "sync-stream"
    >
  >;
  generateObject: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  streamObjectSync: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKResult,
      AISDKChannelContext,
      unknown,
      "sync-stream"
    >
  >;
  embed: MaterializedChannel<
    ChannelSpec<
      [AISDKEmbedParams],
      AISDKEmbeddingResult,
      AISDKChannelContext,
      never,
      "async"
    >
  >;
  embedMany: MaterializedChannel<
    ChannelSpec<
      [AISDKEmbedParams],
      AISDKEmbeddingResult,
      AISDKChannelContext,
      never,
      "async"
    >
  >;
  rerank: MaterializedChannel<
    ChannelSpec<
      [AISDKRerankParams],
      AISDKRerankResult,
      AISDKChannelContext,
      never,
      "async"
    >
  >;
  agentGenerate: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  agentStream: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  agentStreamSync: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKResult,
      AISDKChannelContext,
      unknown,
      "sync-stream"
    >
  >;
  toolLoopAgentGenerate: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  toolLoopAgentStream: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  workflowAgentStream: MaterializedChannel<
    ChannelSpec<
      [AISDKCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  v7CreateTelemetryDispatcher: MaterializedChannel<
    ChannelSpec<
      [AISDKV7CreateTelemetryDispatcherArgs],
      AISDKV7TelemetryDispatcher,
      Record<string, unknown>,
      never,
      "sync-stream"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "ai",
    {
      modelGenerate: channel<
        [AISDKCallParams],
        AISDKResult,
        AISDKModelChannelContext
      >({
        channelName: "model.doGenerate",
        kind: "async",
      }),
      modelStream: channel<
        [AISDKCallParams],
        AISDKResult & { stream: ReadableStream<AISDKModelStreamChunk> },
        AISDKModelChannelContext
      >({
        channelName: "model.doStream",
        kind: "async",
      }),
      evaluate: channel<
        [AISDKEvaluateParams],
        AISDKEvaluationResult,
        AISDKChannelContext
      >({
        channelName: "evaluate",
        kind: "async",
      }),
      generateText: channel<
        [AISDKCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "generateText",
        kind: "async",
      }),
      generateImage: channel<
        [AISDKGenerateImageParams],
        AISDKResult,
        AISDKChannelContext
      >({
        channelName: "generateImage",
        kind: "async",
      }),
      streamTextSync: channel<
        [AISDKCallParams],
        AISDKResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "streamText.sync",
        kind: "sync-stream",
      }),
      generateObject: channel<
        [AISDKCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "generateObject",
        kind: "async",
      }),
      streamObjectSync: channel<
        [AISDKCallParams],
        AISDKResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "streamObject.sync",
        kind: "sync-stream",
      }),
      embed: channel<
        [AISDKEmbedParams],
        AISDKEmbeddingResult,
        AISDKChannelContext
      >({
        channelName: "embed",
        kind: "async",
      }),
      embedMany: channel<
        [AISDKEmbedParams],
        AISDKEmbeddingResult,
        AISDKChannelContext
      >({
        channelName: "embedMany",
        kind: "async",
      }),
      rerank: channel<
        [AISDKRerankParams],
        AISDKRerankResult,
        AISDKChannelContext
      >({
        channelName: "rerank",
        kind: "async",
      }),
      agentGenerate: channel<
        [AISDKCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "Agent.generate",
        kind: "async",
      }),
      agentStream: channel<
        [AISDKCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "Agent.stream",
        kind: "async",
      }),
      agentStreamSync: channel<
        [AISDKCallParams],
        AISDKResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "Agent.stream.sync",
        kind: "sync-stream",
      }),
      toolLoopAgentGenerate: channel<
        [AISDKCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "ToolLoopAgent.generate",
        kind: "async",
      }),
      toolLoopAgentStream: channel<
        [AISDKCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "ToolLoopAgent.stream",
        kind: "async",
      }),
      workflowAgentStream: channel<
        [AISDKCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "WorkflowAgent.stream",
        kind: "async",
      }),
      v7CreateTelemetryDispatcher: channel<
        [AISDKV7CreateTelemetryDispatcherArgs],
        AISDKV7TelemetryDispatcher
      >({
        channelName: "createTelemetryDispatcher",
        kind: "sync-stream",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.AI_SDK },
  ))();

export const harnessAgentChannels: {
  createSession: MaterializedChannel<
    ChannelSpec<
      [AISDKHarnessAgentCreateSessionParams?],
      AISDKHarnessAgentSession,
      AISDKChannelContext,
      never,
      "async"
    >
  >;
  generate: MaterializedChannel<
    ChannelSpec<
      [AISDKHarnessAgentCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  stream: MaterializedChannel<
    ChannelSpec<
      [AISDKHarnessAgentCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  continueGenerate: MaterializedChannel<
    ChannelSpec<
      [AISDKHarnessAgentCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
  continueStream: MaterializedChannel<
    ChannelSpec<
      [AISDKHarnessAgentCallParams],
      AISDKStreamResult,
      AISDKChannelContext,
      unknown,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@ai-sdk/harness",
    {
      createSession: channel<
        [AISDKHarnessAgentCreateSessionParams?],
        AISDKHarnessAgentSession,
        AISDKChannelContext
      >({
        channelName: "HarnessAgent.createSession",
        kind: "async",
      }),
      generate: channel<
        [AISDKHarnessAgentCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "HarnessAgent.generate",
        kind: "async",
      }),
      stream: channel<
        [AISDKHarnessAgentCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "HarnessAgent.stream",
        kind: "async",
      }),
      continueGenerate: channel<
        [AISDKHarnessAgentCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "HarnessAgent.continueGenerate",
        kind: "async",
      }),
      continueStream: channel<
        [AISDKHarnessAgentCallParams],
        AISDKStreamResult,
        AISDKChannelContext,
        unknown
      >({
        channelName: "HarnessAgent.continueStream",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.AI_SDK },
  ))();
