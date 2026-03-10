import { channel, defineChannels } from "../core/channel-definitions";
import type {
  AISDKCallParams,
  AISDKResult,
} from "../../vendor-sdk-types/ai-sdk";

type AISDKStreamResult = AISDKResult | AsyncIterable<unknown>;

export const aiSDKChannels = defineChannels({
  generateText: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "generateText",
    fullChannelName: "orchestrion:ai:generateText",
    kind: "async",
  }),
  streamText: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "streamText",
    fullChannelName: "orchestrion:ai:streamText",
    kind: "async",
  }),
  generateObject: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "generateObject",
    fullChannelName: "orchestrion:ai:generateObject",
    kind: "async",
  }),
  streamObject: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "streamObject",
    fullChannelName: "orchestrion:ai:streamObject",
    kind: "async",
  }),
  agentGenerate: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "Agent.generate",
    fullChannelName: "orchestrion:ai:Agent.generate",
    kind: "async",
  }),
  agentStream: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "Agent.stream",
    fullChannelName: "orchestrion:ai:Agent.stream",
    kind: "async",
  }),
});
