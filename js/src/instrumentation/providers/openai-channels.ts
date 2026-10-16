import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import type {
  OpenAIMediaParams,
  OpenAIMediaResponse,
} from "../../vendor-sdk-types/openai-media";
import type { CompiledPrompt } from "../../logger/prompts";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type { StartOf } from "../core/channel-definitions";
import type { ChannelSpanInfo, SpanInfoCarrier } from "../core/types";
import type {
  OpenAIChatCompletion,
  OpenAIChatCompletionChunk,
  OpenAIChatCreateParams,
  OpenAIChatStream,
  OpenAIEmbeddingCreateParams,
  OpenAIEmbeddingResponse,
  OpenAIModerationCreateParams,
  OpenAIModerationResponse,
  OpenAIResponse,
  OpenAIResponseCompactParams,
  OpenAIResponseCreateParams,
  OpenAIResponseStreamEvent,
} from "../../vendor-sdk-types/openai";
import type {
  CompleteOpenAIBatchTraceArgs,
  OpenAIBatchLike,
  OpenAIBatchesRetrieveTraceArgs,
  OpenAIFileLike,
  OpenAIFilesCreateTraceArgs,
} from "../../openai-batch-types";
import type {
  OpenAIAgentsTraceStartChannelArgs,
  OpenAIAgentsTraceState,
} from "../../openai-agents-api-types";

type OpenAIChatSpanInfo = NonNullable<CompiledPrompt<"chat">["span_info"]>;

type OpenAIChannelExtras<TSpanInfo extends ChannelSpanInfo = ChannelSpanInfo> =
  SpanInfoCarrier<TSpanInfo> & {
    response?: Response;
  };

type OpenAIChatChannelExtras = OpenAIChannelExtras<OpenAIChatSpanInfo>;
type OpenAIResponsesChannelExtras = OpenAIChannelExtras;

export const openAIChannels: {
  imagesGenerate: MaterializedChannel<
    ChannelSpec<
      [OpenAIMediaParams, unknown?],
      OpenAIMediaResponse,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  imagesEdit: MaterializedChannel<
    ChannelSpec<
      [OpenAIMediaParams, unknown?],
      OpenAIMediaResponse,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  imagesCreateVariation: MaterializedChannel<
    ChannelSpec<
      [OpenAIMediaParams, unknown?],
      OpenAIMediaResponse,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  audioSpeechCreate: MaterializedChannel<
    ChannelSpec<
      [OpenAIMediaParams, unknown?],
      OpenAIMediaResponse,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  audioTranscriptionsCreate: MaterializedChannel<
    ChannelSpec<
      [OpenAIMediaParams, unknown?],
      OpenAIMediaResponse,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  audioTranslationsCreate: MaterializedChannel<
    ChannelSpec<
      [OpenAIMediaParams, unknown?],
      OpenAIMediaResponse,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  agentsTraceStart: MaterializedChannel<
    ChannelSpec<
      [OpenAIAgentsTraceStartChannelArgs],
      OpenAIAgentsTraceState | null,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  agentsTraceCapture: MaterializedChannel<
    ChannelSpec<
      [{ event: unknown; state: OpenAIAgentsTraceState | null }],
      OpenAIAgentsTraceState | null,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  agentsTraceFail: MaterializedChannel<
    ChannelSpec<
      [{ error: unknown; state: OpenAIAgentsTraceState | null }],
      OpenAIAgentsTraceState | null,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  filesCreateTraced: MaterializedChannel<
    ChannelSpec<
      [OpenAIFilesCreateTraceArgs],
      OpenAIFileLike,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  batchesRetrieveTraced: MaterializedChannel<
    ChannelSpec<
      [OpenAIBatchesRetrieveTraceArgs],
      OpenAIBatchLike,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  batchesCompleteTrace: MaterializedChannel<
    ChannelSpec<
      [CompleteOpenAIBatchTraceArgs],
      void,
      OpenAIChannelExtras,
      never,
      "async"
    >
  >;
  chatCompletionsCreate: MaterializedChannel<
    ChannelSpec<
      [OpenAIChatCreateParams],
      OpenAIChatCompletion | OpenAIChatStream,
      OpenAIChatChannelExtras,
      OpenAIChatCompletionChunk,
      "async"
    >
  >;
  embeddingsCreate: MaterializedChannel<
    ChannelSpec<
      [OpenAIEmbeddingCreateParams],
      OpenAIEmbeddingResponse,
      OpenAIChatChannelExtras,
      never,
      "async"
    >
  >;
  betaChatCompletionsParse: MaterializedChannel<
    ChannelSpec<
      [OpenAIChatCreateParams],
      OpenAIChatCompletion,
      OpenAIChatChannelExtras,
      OpenAIChatCompletionChunk,
      "async"
    >
  >;
  betaChatCompletionsStream: MaterializedChannel<
    ChannelSpec<
      [OpenAIChatCreateParams],
      unknown,
      OpenAIChatChannelExtras,
      never,
      "sync-stream"
    >
  >;
  moderationsCreate: MaterializedChannel<
    ChannelSpec<
      [OpenAIModerationCreateParams],
      OpenAIModerationResponse,
      OpenAIChatChannelExtras,
      never,
      "async"
    >
  >;
  responsesCreate: MaterializedChannel<
    ChannelSpec<
      [OpenAIResponseCreateParams],
      OpenAIResponse | AsyncIterable<OpenAIResponseStreamEvent>,
      OpenAIResponsesChannelExtras,
      OpenAIResponseStreamEvent,
      "async"
    >
  >;
  responsesStream: MaterializedChannel<
    ChannelSpec<
      [OpenAIResponseCreateParams],
      unknown,
      OpenAIResponsesChannelExtras,
      OpenAIResponseStreamEvent,
      "sync-stream"
    >
  >;
  responsesParse: MaterializedChannel<
    ChannelSpec<
      [OpenAIResponseCreateParams],
      OpenAIResponse,
      OpenAIResponsesChannelExtras,
      OpenAIResponseStreamEvent,
      "async"
    >
  >;
  responsesCompact: MaterializedChannel<
    ChannelSpec<
      [OpenAIResponseCompactParams],
      OpenAIResponse,
      OpenAIResponsesChannelExtras,
      never,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "openai",
    {
      imagesGenerate: channel<
        [OpenAIMediaParams, unknown?],
        OpenAIMediaResponse,
        OpenAIChannelExtras
      >({ channelName: "images.generate", kind: "async" }),
      imagesEdit: channel<
        [OpenAIMediaParams, unknown?],
        OpenAIMediaResponse,
        OpenAIChannelExtras
      >({ channelName: "images.edit", kind: "async" }),
      imagesCreateVariation: channel<
        [OpenAIMediaParams, unknown?],
        OpenAIMediaResponse,
        OpenAIChannelExtras
      >({ channelName: "images.createVariation", kind: "async" }),
      audioSpeechCreate: channel<
        [OpenAIMediaParams, unknown?],
        OpenAIMediaResponse,
        OpenAIChannelExtras
      >({ channelName: "audio.speech.create", kind: "async" }),
      audioTranscriptionsCreate: channel<
        [OpenAIMediaParams, unknown?],
        OpenAIMediaResponse,
        OpenAIChannelExtras
      >({ channelName: "audio.transcriptions.create", kind: "async" }),
      audioTranslationsCreate: channel<
        [OpenAIMediaParams, unknown?],
        OpenAIMediaResponse,
        OpenAIChannelExtras
      >({ channelName: "audio.translations.create", kind: "async" }),

      agentsTraceStart: channel<
        [OpenAIAgentsTraceStartChannelArgs],
        OpenAIAgentsTraceState | null,
        OpenAIChannelExtras
      >({
        channelName: "agents.trace.start",
        kind: "async",
      }),

      agentsTraceCapture: channel<
        [{ event: unknown; state: OpenAIAgentsTraceState | null }],
        OpenAIAgentsTraceState | null,
        OpenAIChannelExtras
      >({
        channelName: "agents.trace.capture",
        kind: "async",
      }),

      agentsTraceFail: channel<
        [{ error: unknown; state: OpenAIAgentsTraceState | null }],
        OpenAIAgentsTraceState | null,
        OpenAIChannelExtras
      >({
        channelName: "agents.trace.fail",
        kind: "async",
      }),

      filesCreateTraced: channel<
        [OpenAIFilesCreateTraceArgs],
        OpenAIFileLike,
        OpenAIChannelExtras
      >({
        channelName: "files.create-traced",
        kind: "async",
      }),

      batchesRetrieveTraced: channel<
        [OpenAIBatchesRetrieveTraceArgs],
        OpenAIBatchLike,
        OpenAIChannelExtras
      >({
        channelName: "batches.retrieve-traced",
        kind: "async",
      }),

      batchesCompleteTrace: channel<
        [CompleteOpenAIBatchTraceArgs],
        void,
        OpenAIChannelExtras
      >({
        channelName: "batches.complete-trace",
        kind: "async",
      }),

      chatCompletionsCreate: channel<
        [OpenAIChatCreateParams],
        OpenAIChatCompletion | OpenAIChatStream,
        OpenAIChatChannelExtras,
        OpenAIChatCompletionChunk
      >({
        channelName: "chat.completions.create",
        kind: "async",
      }),

      embeddingsCreate: channel<
        [OpenAIEmbeddingCreateParams],
        OpenAIEmbeddingResponse,
        OpenAIChatChannelExtras
      >({
        channelName: "embeddings.create",
        kind: "async",
      }),

      betaChatCompletionsParse: channel<
        [OpenAIChatCreateParams],
        OpenAIChatCompletion,
        OpenAIChatChannelExtras,
        OpenAIChatCompletionChunk
      >({
        channelName: "beta.chat.completions.parse",
        kind: "async",
      }),

      betaChatCompletionsStream: channel<
        [OpenAIChatCreateParams],
        unknown,
        OpenAIChatChannelExtras
      >({
        channelName: "beta.chat.completions.stream",
        kind: "sync-stream",
      }),

      moderationsCreate: channel<
        [OpenAIModerationCreateParams],
        OpenAIModerationResponse,
        OpenAIChatChannelExtras
      >({
        channelName: "moderations.create",
        kind: "async",
      }),

      responsesCreate: channel<
        [OpenAIResponseCreateParams],
        OpenAIResponse | AsyncIterable<OpenAIResponseStreamEvent>,
        OpenAIResponsesChannelExtras,
        OpenAIResponseStreamEvent
      >({
        channelName: "responses.create",
        kind: "async",
      }),

      responsesStream: channel<
        [OpenAIResponseCreateParams],
        unknown,
        OpenAIResponsesChannelExtras,
        OpenAIResponseStreamEvent
      >({
        channelName: "responses.stream",
        kind: "sync-stream",
      }),

      responsesParse: channel<
        [OpenAIResponseCreateParams],
        OpenAIResponse,
        OpenAIResponsesChannelExtras,
        OpenAIResponseStreamEvent
      >({
        channelName: "responses.parse",
        kind: "async",
      }),

      responsesCompact: channel<
        [OpenAIResponseCompactParams],
        OpenAIResponse,
        OpenAIResponsesChannelExtras
      >({
        channelName: "responses.compact",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.OPENAI },
  ))();

export type OpenAIChannel =
  (typeof openAIChannels)[keyof typeof openAIChannels];

export type OpenAIAsyncChannel = Extract<OpenAIChannel, { kind: "async" }>;

export type OpenAIStartContext<TChannel extends OpenAIChannel = OpenAIChannel> =
  StartOf<TChannel>;
