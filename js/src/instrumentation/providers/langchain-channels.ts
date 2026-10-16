import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  LangChainCallbackManagerConfigureArgs,
  LangChainCallbackManagerConfigureResult,
} from "../../vendor-sdk-types/langchain";

export const langChainChannels: {
  configure: MaterializedChannel<
    ChannelSpec<
      LangChainCallbackManagerConfigureArgs,
      LangChainCallbackManagerConfigureResult,
      Record<string, unknown>,
      never,
      "sync-stream"
    >
  >;
  configureSync: MaterializedChannel<
    ChannelSpec<
      LangChainCallbackManagerConfigureArgs,
      LangChainCallbackManagerConfigureResult,
      Record<string, unknown>,
      never,
      "sync-stream"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@langchain/core",
    {
      configure: channel<
        LangChainCallbackManagerConfigureArgs,
        LangChainCallbackManagerConfigureResult
      >({
        channelName: "CallbackManager.configure",
        kind: "sync-stream",
      }),
      configureSync: channel<
        LangChainCallbackManagerConfigureArgs,
        LangChainCallbackManagerConfigureResult
      >({
        channelName: "CallbackManager._configureSync",
        kind: "sync-stream",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.LANGCHAIN },
  ))();
