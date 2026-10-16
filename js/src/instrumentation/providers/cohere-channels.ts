import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  CohereChatRequest,
  CohereChatResponse,
  CohereChatStreamEvent,
  CohereChatStreamResult,
  CohereEmbedRequest,
  CohereEmbedResponse,
  CohereRerankRequest,
  CohereRerankResponse,
} from "../../vendor-sdk-types/cohere";

export const cohereChannels: {
  chat: MaterializedChannel<
    ChannelSpec<
      [CohereChatRequest],
      CohereChatResponse,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  chatStream: MaterializedChannel<
    ChannelSpec<
      [CohereChatRequest],
      CohereChatStreamResult,
      Record<string, unknown>,
      CohereChatStreamEvent,
      "async"
    >
  >;
  embed: MaterializedChannel<
    ChannelSpec<
      [CohereEmbedRequest],
      CohereEmbedResponse,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  rerank: MaterializedChannel<
    ChannelSpec<
      [CohereRerankRequest],
      CohereRerankResponse,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "cohere-ai",
    {
      chat: channel<[CohereChatRequest], CohereChatResponse>({
        channelName: "chat",
        kind: "async",
      }),

      chatStream: channel<
        [CohereChatRequest],
        CohereChatStreamResult,
        Record<string, unknown>,
        CohereChatStreamEvent
      >({
        channelName: "chatStream",
        kind: "async",
      }),

      embed: channel<[CohereEmbedRequest], CohereEmbedResponse>({
        channelName: "embed",
        kind: "async",
      }),

      rerank: channel<[CohereRerankRequest], CohereRerankResponse>({
        channelName: "rerank",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.COHERE },
  ))();
