import type { LettaMessage } from "../../vendor-sdk-types/letta-agent-sdk";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";

export const lettaAgentSDKChannels = defineChannels(
  "@letta-ai/letta-agent-sdk",
  {
    createAgent: channel<[Record<string, unknown>?], string>({
      channelName: "LettaAgentClient.createAgent",
      kind: "async",
    }),
    resumeSession: channel<[string, Record<string, unknown>?], object>({
      channelName: "LettaAgentClient.resumeSession",
      kind: "sync-stream",
    }),
    send: channel<[unknown, Record<string, unknown>?], void>({
      channelName: "LettaSession.send",
      kind: "async",
    }),
    stream: channel<[], AsyncGenerator<LettaMessage>>({
      channelName: "LettaSession.stream",
      kind: "sync-stream",
    }),
    close: channel<[], void>({
      channelName: "LettaSession.close",
      kind: "sync-stream",
    }),
  },
  { instrumentationName: INSTRUMENTATION_NAMES.LETTA_AGENT_SDK },
);

export type { LettaMessage } from "../../vendor-sdk-types/letta-agent-sdk";
