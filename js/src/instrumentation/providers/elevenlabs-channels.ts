import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  ElevenLabsAudio,
  ElevenLabsSpeechArgs,
  ElevenLabsTimestampAudio,
  ElevenLabsTranscription,
  ElevenLabsTranscriptionRequest,
} from "../../vendor-sdk-types/elevenlabs";

export const elevenLabsChannels: {
  convert: MaterializedChannel<
    ChannelSpec<
      ElevenLabsSpeechArgs,
      ElevenLabsAudio,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  stream: MaterializedChannel<
    ChannelSpec<
      ElevenLabsSpeechArgs,
      ElevenLabsAudio,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  convertWithTimestamps: MaterializedChannel<
    ChannelSpec<
      ElevenLabsSpeechArgs,
      ElevenLabsTimestampAudio,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  streamWithTimestamps: MaterializedChannel<
    ChannelSpec<
      ElevenLabsSpeechArgs,
      AsyncIterable<ElevenLabsTimestampAudio>,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  transcribe: MaterializedChannel<
    ChannelSpec<
      [ElevenLabsTranscriptionRequest, unknown?],
      ElevenLabsTranscription,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@elevenlabs/elevenlabs-js",
    {
      convert: channel<ElevenLabsSpeechArgs, ElevenLabsAudio>({
        channelName: "textToSpeech.convert",
        kind: "async",
      }),
      stream: channel<ElevenLabsSpeechArgs, ElevenLabsAudio>({
        channelName: "textToSpeech.stream",
        kind: "async",
      }),
      convertWithTimestamps: channel<
        ElevenLabsSpeechArgs,
        ElevenLabsTimestampAudio
      >({ channelName: "textToSpeech.convertWithTimestamps", kind: "async" }),
      streamWithTimestamps: channel<
        ElevenLabsSpeechArgs,
        AsyncIterable<ElevenLabsTimestampAudio>
      >({ channelName: "textToSpeech.streamWithTimestamps", kind: "async" }),
      transcribe: channel<
        [ElevenLabsTranscriptionRequest, unknown?],
        ElevenLabsTranscription
      >({ channelName: "speechToText.convert", kind: "async" }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.ELEVENLABS },
  ))();
