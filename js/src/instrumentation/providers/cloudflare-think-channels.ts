import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  CloudflareThinkInstance,
  CloudflareThinkStreamableResult,
  CloudflareThinkTurnInput,
} from "../../vendor-sdk-types/cloudflare-think";

type CloudflareThinkChannelContext = {
  self?: CloudflareThinkInstance;
  moduleVersion?: string;
};

export const cloudflareThinkChannels: {
  runInferenceLoop: MaterializedChannel<
    ChannelSpec<
      [CloudflareThinkTurnInput],
      CloudflareThinkStreamableResult,
      CloudflareThinkChannelContext,
      never,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@cloudflare/think",
    {
      runInferenceLoop: channel<
        [CloudflareThinkTurnInput],
        CloudflareThinkStreamableResult,
        CloudflareThinkChannelContext
      >({
        channelName: "Think.runInferenceLoop",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.CLOUDFLARE_THINK },
  ))();
