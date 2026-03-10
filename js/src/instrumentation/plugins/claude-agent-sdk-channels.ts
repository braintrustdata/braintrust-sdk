import { channel, defineChannels } from "../core/channel-definitions";
import type {
  ClaudeAgentSDKMessage,
  ClaudeAgentSDKQueryParams,
} from "../../vendor-sdk-types/claude-agent-sdk";

export const claudeAgentSDKChannels = defineChannels({
  query: channel<
    [ClaudeAgentSDKQueryParams],
    AsyncIterable<ClaudeAgentSDKMessage>,
    Record<string, never>,
    ClaudeAgentSDKMessage
  >({
    channelName: "query",
    fullChannelName: "orchestrion:@anthropic-ai/claude-agent-sdk:query",
    kind: "async",
  }),
});
