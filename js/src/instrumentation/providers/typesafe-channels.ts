import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  TypeSafeSystemOneRequest,
  TypeSafeSystemOneResult,
} from "../../vendor-sdk-types/typesafe";
import { channel, defineChannels } from "../core/channel-definitions";

export const typeSafeChannels: {
  systemOne: MaterializedChannel<
    ChannelSpec<
      [TypeSafeSystemOneRequest, options?: unknown],
      TypeSafeSystemOneResult,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@typesafe-ai/sdk",
    {
      systemOne: channel<
        [TypeSafeSystemOneRequest, options?: unknown],
        TypeSafeSystemOneResult
      >({
        channelName: "systemOne",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.TYPESAFE },
  ))();
