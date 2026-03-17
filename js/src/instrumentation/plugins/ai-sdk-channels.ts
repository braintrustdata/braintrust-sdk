import { channel, defineChannels } from "../core/channel-definitions";
import type {
  AISDKCallParams,
  AISDKResult,
} from "../../vendor-sdk-types/ai-sdk";

type AISDKStreamResult = AISDKResult | AsyncIterable<unknown>;

export const aiSDKChannels = defineChannels("ai", {
  generateText: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "generateText",
    kind: "async",
  }),
  streamText: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "streamText",
    kind: "async",
  }),
  generateObject: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "generateObject",
    kind: "async",
  }),
  streamObject: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "streamObject",
    kind: "async",
  }),
  agentGenerate: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "Agent.generate",
    kind: "async",
  }),
  agentStream: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "Agent.stream",
    kind: "async",
  }),
  toolLoopAgentGenerate: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "ToolLoopAgent.generate",
    kind: "async",
  }),
  toolLoopAgentStream: channel<
    [AISDKCallParams],
    AISDKStreamResult,
    Record<string, never>,
    unknown
  >({
    channelName: "ToolLoopAgent.stream",
    kind: "async",
  }),
});
