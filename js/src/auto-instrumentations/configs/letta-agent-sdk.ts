import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";
import { lettaAgentSDKChannels } from "../../instrumentation/plugins/letta-agent-sdk-channels";

// Both entrypoints bundle the same client and session base classes. Local,
// remote, and cloud sessions all execute turns through RemoteClientSessionCore.
export const lettaAgentSDKConfigs: InstrumentationConfig[] = [
  "dist/index.js",
  "dist/client-entry.js",
].flatMap((filePath) =>
  [
    {
      channel: lettaAgentSDKChannels.createAgent,
      className: "LettaAgentClientBase",
      methodName: "createAgent",
      kind: "Async" as const,
    },
    {
      channel: lettaAgentSDKChannels.resumeSession,
      className: "LettaAgentClientBase",
      methodName: "resumeSession",
      kind: "Sync" as const,
    },
    {
      channel: lettaAgentSDKChannels.send,
      className: "RemoteClientSessionCore",
      methodName: "send",
      kind: "Async" as const,
    },
    {
      channel: lettaAgentSDKChannels.stream,
      className: "RemoteClientSessionCore",
      methodName: "stream",
      kind: "Sync" as const,
    },
    {
      channel: lettaAgentSDKChannels.close,
      className: "RemoteClientSessionCore",
      methodName: "close",
      kind: "Sync" as const,
    },
  ].map(({ channel, ...functionQuery }) => ({
    channelName: channel.channelName,
    module: {
      name: "@letta-ai/letta-agent-sdk",
      versionRange: ">=0.8.28 <0.9.0",
      filePath,
    },
    functionQuery,
  })),
);
