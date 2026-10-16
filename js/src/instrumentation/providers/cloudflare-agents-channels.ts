import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  CloudflareAgentToolClass,
  CloudflareRunAgentToolOptions,
  CloudflareRunAgentToolResult,
} from "../../vendor-sdk-types/cloudflare-agents";

type CloudflareAgentsChannelContext = {
  self?: unknown;
};

export const cloudflareAgentsChannels: {
  runAgentTool: MaterializedChannel<
    ChannelSpec<
      [CloudflareAgentToolClass, CloudflareRunAgentToolOptions],
      CloudflareRunAgentToolResult,
      CloudflareAgentsChannelContext,
      never,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "agents",
    {
      runAgentTool: channel<
        [CloudflareAgentToolClass, CloudflareRunAgentToolOptions],
        CloudflareRunAgentToolResult,
        CloudflareAgentsChannelContext
      >({
        channelName: "Agent.runAgentTool",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.CLOUDFLARE_AGENTS },
  ))();
