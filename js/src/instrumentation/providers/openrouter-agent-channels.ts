import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  OpenRouterAgentCallModelArgs,
  OpenRouterAgentCallModelRequest,
} from "../../vendor-sdk-types/openrouter-agent";

export const openRouterAgentChannels: {
  callModel: MaterializedChannel<
    ChannelSpec<
      OpenRouterAgentCallModelArgs,
      unknown,
      Record<string, unknown>,
      never,
      "sync-stream"
    >
  >;
  callModelTurn: MaterializedChannel<
    ChannelSpec<
      [OpenRouterAgentCallModelRequest | undefined],
      unknown,
      {
        step: number;
        stepType: "initial" | "continue";
      },
      never,
      "async"
    >
  >;
  toolExecute: MaterializedChannel<
    ChannelSpec<
      [unknown],
      unknown | AsyncIterable<unknown>,
      {
        span_info?: {
          name?: string;
        };
        toolCallId?: string;
        toolName: string;
      },
      unknown,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@openrouter/agent",
    {
      callModel: channel<OpenRouterAgentCallModelArgs, unknown>({
        channelName: "callModel",
        kind: "sync-stream",
      }),

      callModelTurn: channel<
        [OpenRouterAgentCallModelRequest | undefined],
        unknown,
        {
          step: number;
          stepType: "initial" | "continue";
        }
      >({
        channelName: "callModel.turn",
        kind: "async",
      }),

      toolExecute: channel<
        [unknown],
        unknown | AsyncIterable<unknown>,
        {
          span_info?: {
            name?: string;
          };
          toolCallId?: string;
          toolName: string;
        },
        unknown
      >({
        channelName: "tool.execute",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.OPENROUTER_AGENT },
  ))();
