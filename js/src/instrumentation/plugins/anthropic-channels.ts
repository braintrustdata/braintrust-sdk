import { channel, defineChannels } from "../core/channel-definitions";
import type {
  AnthropicCreateParams,
  AnthropicMessage,
  AnthropicStreamEvent,
} from "../../vendor-sdk-types/anthropic";

type AnthropicResult = AnthropicMessage | AsyncIterable<AnthropicStreamEvent>;

export const anthropicChannels = defineChannels({
  messagesCreate: channel<
    [AnthropicCreateParams],
    AnthropicResult,
    Record<string, never>,
    AnthropicStreamEvent
  >({
    channelName: "messages.create",
    fullChannelName: "orchestrion:@anthropic-ai/sdk:messages.create",
    kind: "async",
  }),
  betaMessagesCreate: channel<
    [AnthropicCreateParams],
    AnthropicResult,
    Record<string, never>,
    AnthropicStreamEvent
  >({
    channelName: "beta.messages.create",
    fullChannelName: "orchestrion:@anthropic-ai/sdk:beta.messages.create",
    kind: "async",
  }),
});
