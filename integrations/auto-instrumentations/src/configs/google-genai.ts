import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";

/**
 * Instrumentation configurations for the Google GenAI SDK.
 *
 * These configs define which functions to instrument and what channel
 * to emit events on. They are used by orchestrion-js to perform AST
 * transformation at build-time or load-time.
 *
 * NOTE: Channel names should NOT include the braintrust: prefix. The code-transformer
 * will prepend "orchestrion:google-genai:" to these names, resulting in final channel names like:
 * "orchestrion:google-genai:models.generateContent"
 */
export const googleGenAIConfigs: InstrumentationConfig[] = [
  // GenerativeModel.generateContent
  {
    channelName: "models.generateContent",
    module: {
      name: "@google/genai",
      versionRange: ">=0.21.0",
      filePath: "dist/index.mjs",
    },
    functionQuery: {
      className: "GenerativeModel",
      methodName: "generateContent",
      kind: "Async",
    },
  },

  // GenerativeModel.generateContentStream
  {
    channelName: "models.generateContentStream",
    module: {
      name: "@google/genai",
      versionRange: ">=0.21.0",
      filePath: "dist/index.mjs",
    },
    functionQuery: {
      className: "GenerativeModel",
      methodName: "generateContentStream",
      kind: "Async",
    },
  },
];
