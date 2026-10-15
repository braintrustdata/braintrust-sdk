import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  CloudflareAIChatResponseResult,
  CloudflareAIChatTurnCallback,
  CloudflareAIChatTurnOptions,
} from "../../vendor-sdk-types/cloudflare-ai-chat";

type CloudflareAIChatChannelContext = {
  self?: unknown;
};

export const cloudflareAIChatChannels: {
  runExclusiveChatTurn: MaterializedChannel<
    ChannelSpec<
      [string, CloudflareAIChatTurnCallback, CloudflareAIChatTurnOptions?],
      unknown,
      CloudflareAIChatChannelContext,
      never,
      "async"
    >
  >;
  onChatResponse: MaterializedChannel<
    ChannelSpec<
      [CloudflareAIChatResponseResult],
      unknown,
      CloudflareAIChatChannelContext,
      never,
      "sync-stream"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@cloudflare/ai-chat",
    {
      runExclusiveChatTurn: channel<
        [string, CloudflareAIChatTurnCallback, CloudflareAIChatTurnOptions?],
        unknown,
        CloudflareAIChatChannelContext
      >({
        channelName: "AIChatAgent._runExclusiveChatTurn",
        kind: "async",
      }),

      onChatResponse: channel<
        [CloudflareAIChatResponseResult],
        unknown,
        CloudflareAIChatChannelContext
      >({
        channelName: "AIChatAgent.onChatResponse",
        kind: "sync-stream",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.CLOUDFLARE_AI_CHAT },
  ))();
