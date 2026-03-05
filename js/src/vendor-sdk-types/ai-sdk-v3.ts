import type {
  AISDKGenerateFunction,
  AISDKNamespaceBase,
  AISDKStreamFunction,
} from "./ai-sdk-common";

export interface AISDKV3 extends AISDKNamespaceBase {
  experimental_generateText?: AISDKGenerateFunction;
  experimental_streamText?: AISDKStreamFunction;
  experimental_generateObject?: AISDKGenerateFunction;
  experimental_streamObject?: AISDKStreamFunction;
}
