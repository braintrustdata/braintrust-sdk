import type {
  MaterializedChannel,
  ChannelSpec,
} from "../core/channel-definitions";
import { channel, defineChannels } from "../core/channel-definitions";
import { INSTRUMENTATION_NAMES } from "../../span-origin";
import type {
  GoogleGenAIEmbedContentParams,
  GoogleGenAIEmbedContentResponse,
  GoogleGenAIEditImageParams,
  GoogleGenAIEditImageResponse,
  GoogleGenAIGenerateContentParams,
  GoogleGenAIGenerateContentResponse,
  GoogleGenAIGenerateImagesParams,
  GoogleGenAIGenerateImagesResponse,
  GoogleGenAIGenerateVideosOperation,
  GoogleGenAIGenerateVideosParams,
  GoogleGenAIInteraction,
  GoogleGenAIInteractionCreateParams,
  GoogleGenAIInteractionSSEEvent,
} from "../../vendor-sdk-types/google-genai";

type GoogleGenAIStreamingResult =
  | GoogleGenAIGenerateContentResponse
  | AsyncIterable<GoogleGenAIGenerateContentResponse>;
type GoogleGenAIInteractionResult =
  | GoogleGenAIInteraction
  | AsyncIterable<GoogleGenAIInteractionSSEEvent>;

export const googleGenAIChannels: {
  generateContent: MaterializedChannel<
    ChannelSpec<
      [GoogleGenAIGenerateContentParams],
      GoogleGenAIGenerateContentResponse,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  generateContentStream: MaterializedChannel<
    ChannelSpec<
      [GoogleGenAIGenerateContentParams],
      GoogleGenAIStreamingResult,
      Record<string, unknown>,
      GoogleGenAIGenerateContentResponse,
      "async"
    >
  >;
  embedContent: MaterializedChannel<
    ChannelSpec<
      [GoogleGenAIEmbedContentParams],
      GoogleGenAIEmbedContentResponse,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  generateImages: MaterializedChannel<
    ChannelSpec<
      [GoogleGenAIGenerateImagesParams],
      GoogleGenAIGenerateImagesResponse,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  editImage: MaterializedChannel<
    ChannelSpec<
      [GoogleGenAIEditImageParams],
      GoogleGenAIEditImageResponse,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  generateVideos: MaterializedChannel<
    ChannelSpec<
      [GoogleGenAIGenerateVideosParams],
      GoogleGenAIGenerateVideosOperation,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  httpResponseJson: MaterializedChannel<
    ChannelSpec<
      [],
      GoogleGenAIEmbedContentResponse,
      Record<string, unknown>,
      never,
      "async"
    >
  >;
  interactionsCreate: MaterializedChannel<
    ChannelSpec<
      [GoogleGenAIInteractionCreateParams, Record<string, unknown>?],
      GoogleGenAIInteractionResult,
      Record<string, unknown>,
      GoogleGenAIInteractionSSEEvent,
      "async"
    >
  >;
} = /* @__PURE__ */ (() =>
  defineChannels(
    "@google/genai",
    {
      generateContent: channel<
        [GoogleGenAIGenerateContentParams],
        GoogleGenAIGenerateContentResponse
      >({
        channelName: "models.generateContent",
        kind: "async",
      }),
      generateContentStream: channel<
        [GoogleGenAIGenerateContentParams],
        GoogleGenAIStreamingResult,
        Record<string, unknown>,
        GoogleGenAIGenerateContentResponse
      >({
        channelName: "models.generateContentStream",
        kind: "async",
      }),
      embedContent: channel<
        [GoogleGenAIEmbedContentParams],
        GoogleGenAIEmbedContentResponse
      >({
        channelName: "models.embedContent",
        kind: "async",
      }),
      generateImages: channel<
        [GoogleGenAIGenerateImagesParams],
        GoogleGenAIGenerateImagesResponse
      >({
        channelName: "models.generateImages",
        kind: "async",
      }),
      editImage: channel<
        [GoogleGenAIEditImageParams],
        GoogleGenAIEditImageResponse
      >({
        channelName: "models.editImage",
        kind: "async",
      }),
      generateVideos: channel<
        [GoogleGenAIGenerateVideosParams],
        GoogleGenAIGenerateVideosOperation
      >({
        channelName: "models.generateVideos",
        kind: "async",
      }),
      httpResponseJson: channel<[], GoogleGenAIEmbedContentResponse>({
        channelName: "httpResponse.json",
        kind: "async",
      }),
      interactionsCreate: channel<
        [GoogleGenAIInteractionCreateParams, Record<string, unknown>?],
        GoogleGenAIInteractionResult,
        Record<string, unknown>,
        GoogleGenAIInteractionSSEEvent
      >({
        channelName: "interactions.create",
        kind: "async",
      }),
    },
    { instrumentationName: INSTRUMENTATION_NAMES.GOOGLE_GENAI },
  ))();
