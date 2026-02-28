import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";

/**
 * Instrumentation configurations for the Vercel AI SDK.
 *
 * These configs define which functions to instrument and what channel
 * to emit events on. They are used by orchestrion-js to perform AST
 * transformation at build-time or load-time.
 *
 * NOTE: Channel names should NOT include the braintrust: prefix. The code-transformer
 * will prepend "orchestrion:ai-sdk:" to these names, resulting in final channel names like:
 * "orchestrion:ai-sdk:generateText"
 */
export const aiSDKConfigs: InstrumentationConfig[] = [
  // generateText - async function
  {
    channelName: "generateText",
    module: {
      name: "ai",
      versionRange: ">=3.0.0",
      filePath: "dist/index.mjs",
    },
    functionQuery: {
      functionName: "generateText",
      kind: "Async",
    },
  },

  // streamText - async function
  {
    channelName: "streamText",
    module: {
      name: "ai",
      versionRange: ">=3.0.0",
      filePath: "dist/index.mjs",
    },
    functionQuery: {
      functionName: "streamText",
      kind: "Async",
    },
  },

  // generateObject - async function
  {
    channelName: "generateObject",
    module: {
      name: "ai",
      versionRange: ">=3.0.0",
      filePath: "dist/index.mjs",
    },
    functionQuery: {
      functionName: "generateObject",
      kind: "Async",
    },
  },

  // streamObject - async function
  {
    channelName: "streamObject",
    module: {
      name: "ai",
      versionRange: ">=3.0.0",
      filePath: "dist/index.mjs",
    },
    functionQuery: {
      functionName: "streamObject",
      kind: "Async",
    },
  },

  // Agent.generate - async method (v3-v5 only, Agent structure changed in v6)
  {
    channelName: "Agent.generate",
    module: {
      name: "ai",
      versionRange: ">=3.0.0 <6.0.0",
      filePath: "dist/index.mjs",
    },
    functionQuery: {
      className: "Agent",
      methodName: "generate",
      kind: "Async",
    },
  },

  // Agent.stream - async method (v3-v5 only, Agent structure changed in v6)
  {
    channelName: "Agent.stream",
    module: {
      name: "ai",
      versionRange: ">=3.0.0 <6.0.0",
      filePath: "dist/index.mjs",
    },
    functionQuery: {
      className: "Agent",
      methodName: "stream",
      kind: "Async",
    },
  },
];
