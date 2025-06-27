import {
  LanguageModelV2CallOptions,
  LanguageModelV2Middleware,
} from "@ai-sdk/provider";

export interface MiddlewareConfig {
  debug?: boolean;
  name?: string;
}

export function Middleware(
  config: MiddlewareConfig = {},
): LanguageModelV2Middleware {
  const { debug = false, name = "BraintrustMiddleware" } = config;
  let callCount = 0;

  return {
    transformParams: async ({ params }) => {
      callCount++;
      if (debug) {
        console.log(
          `[${name}] transformParams called (call #${callCount})`,
          params,
        );
      }
      return params;
    },
    wrapGenerate: async ({ doGenerate, params }) => {
      if (debug) {
        console.log(`[${name}] wrapGenerate called`, doGenerate, params);
      }
      return doGenerate(params);
    },
    wrapStream: async ({ doStream, params }) => {
      if (debug) {
        console.log(`[${name}] wrapStream called`, doStream, params);
      }
      return doStream(params);
    },
  };
}
