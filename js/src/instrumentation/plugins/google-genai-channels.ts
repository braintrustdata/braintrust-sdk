import { channel, defineChannels } from "../core/channel-definitions";
import type {
  GoogleGenAIGenerateContentParams,
  GoogleGenAIGenerateContentResponse,
} from "../../vendor-sdk-types/google-genai";

type GoogleGenAIStreamingResult =
  | GoogleGenAIGenerateContentResponse
  | AsyncIterable<GoogleGenAIGenerateContentResponse>;

export const googleGenAIChannels = defineChannels({
  generateContent: channel<
    [GoogleGenAIGenerateContentParams],
    GoogleGenAIGenerateContentResponse
  >({
    channelName: "models.generateContent",
    fullChannelName: "orchestrion:@google/genai:models.generateContent",
    kind: "async",
  }),
  generateContentStream: channel<
    [GoogleGenAIGenerateContentParams],
    GoogleGenAIStreamingResult,
    Record<string, never>,
    GoogleGenAIGenerateContentResponse
  >({
    channelName: "models.generateContentStream",
    fullChannelName: "orchestrion:@google/genai:models.generateContentStream",
    kind: "async",
  }),
});
