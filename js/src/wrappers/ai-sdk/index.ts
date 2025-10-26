export { wrapAISDK } from "./ai-sdk";

/**
 * @deprecated Use `wrapAISDK` instead.
 */
export const deprecated_BraintrustMiddleware = (_config: unknown) => {
  // TODO: use wrapAISDK proper
  // TODO: name & spanInfo support?
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrapGenerate: async ({ doGenerate }: any) => {
      return await doGenerate();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wrapStream: async ({ doStream }: any) => {
      return await doStream();
    },
  };
};

/**
 * @deprecated Use `wrapAISDK` instead.
 */
export const deprecated_wrapAISDKModel = (model: unknown) => {
  // TODO: use wrapAISDK proper
  return model;
};
