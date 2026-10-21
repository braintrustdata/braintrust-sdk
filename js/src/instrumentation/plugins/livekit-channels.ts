import type { AudioFrame, EndOfTurnInfo, ChatMessage } from "../livekit/types";
import { channel, defineInterceptor } from "../core/interceptor-definitions";
export const livekitChannels = defineInterceptor("@livekit/agents", {
  trace: channel<unknown[], unknown>({
    channelName: "telemetry.trace",
  }),
  provider: channel<unknown[], unknown>({
    channelName: "telemetry.provider",
  }),
  inference: channel<unknown[], unknown>({
    channelName: "generation.inference",
  }),
  conversation: channel<[ChatMessage], unknown>({
    channelName: "session.conversation",
  }),
  userCompleted: channel<[EndOfTurnInfo, unknown?], unknown>({
    channelName: "activity.userCompleted",
  }),
  pipeline: channel<unknown[], unknown>({
    channelName: "activity.pipeline",
  }),
  start: channel<unknown[], unknown>({
    channelName: "session.start",
  }),
  close: channel<unknown[], unknown>({
    channelName: "session.close",
  }),
  input: channel<[ReadableStream<AudioFrame>], unknown>({
    channelName: "activity.input",
  }),
  output: channel<unknown[], unknown>({
    channelName: "session.output",
  }),
  activity: channel<unknown[], unknown>({
    channelName: "activity.start",
  }),
  userTurn: channel<[EndOfTurnInfo], unknown>({
    channelName: "activity.userTurn",
  }),
});
