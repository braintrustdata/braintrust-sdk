import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  ClaudeAgentSDKMessage,
  ClaudeAgentSDKQueryParams,
} from "../../vendor-sdk-types/claude-agent-sdk";

export const claudeAgentSDKChannels: {
  query: MaterializedChannel<
    ChannelSpec<
      [ClaudeAgentSDKQueryParams],
      AsyncIterable<ClaudeAgentSDKMessage>,
      Record<never, never>,
      ClaudeAgentSDKMessage,
      "sync-stream"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@anthropic-ai/claude-agent-sdk",
    {
      query: channel<
        [ClaudeAgentSDKQueryParams],
        AsyncIterable<ClaudeAgentSDKMessage>,
        Record<never, never>,
        ClaudeAgentSDKMessage
      >({
        channelName: "query",
        kind: "sync-stream",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.CLAUDE_AGENT_SDK },
  ))();
