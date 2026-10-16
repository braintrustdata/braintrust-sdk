import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  BedrockRuntimeChannelContext,
  BedrockRuntimeCommandLike,
  BedrockRuntimeConverseStreamEvent,
  BedrockRuntimeResponseStreamEvent,
  BedrockRuntimeSendResult,
} from "../../vendor-sdk-types/bedrock-runtime";

type BedrockRuntimeStreamEvent =
  | BedrockRuntimeConverseStreamEvent
  | BedrockRuntimeResponseStreamEvent;

const clientSendChannel = /* @__PURE__ */ (() =>
  channel<
    [BedrockRuntimeCommandLike, unknown?],
    BedrockRuntimeSendResult,
    BedrockRuntimeChannelContext,
    BedrockRuntimeStreamEvent
  >({
    channelName: "client.send",
    kind: "async",
  }))();

export const bedrockRuntimeChannels: {
  clientSend: MaterializedChannel<
    ChannelSpec<
      [BedrockRuntimeCommandLike, unknown?],
      BedrockRuntimeSendResult,
      BedrockRuntimeChannelContext,
      BedrockRuntimeStreamEvent,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "aws-bedrock-runtime",
    {
      clientSend: clientSendChannel,
    },
    { instrumentationName: INSTRUMENTATION_NAMES.BEDROCK_RUNTIME },
  ))();

export const smithyCoreChannels: {
  clientSend: MaterializedChannel<
    ChannelSpec<
      [BedrockRuntimeCommandLike, unknown?],
      BedrockRuntimeSendResult,
      BedrockRuntimeChannelContext,
      BedrockRuntimeStreamEvent,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@smithy/core",
    {
      clientSend: clientSendChannel,
    },
    { instrumentationName: INSTRUMENTATION_NAMES.BEDROCK_RUNTIME },
  ))();

export const smithyClientChannels: {
  clientSend: MaterializedChannel<
    ChannelSpec<
      [BedrockRuntimeCommandLike, unknown?],
      BedrockRuntimeSendResult,
      BedrockRuntimeChannelContext,
      BedrockRuntimeStreamEvent,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@smithy/smithy-client",
    {
      clientSend: clientSendChannel,
    },
    { instrumentationName: INSTRUMENTATION_NAMES.BEDROCK_RUNTIME },
  ))();
