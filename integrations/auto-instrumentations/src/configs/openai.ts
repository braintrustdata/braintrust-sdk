import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";

/**
 * Instrumentation configurations for the OpenAI SDK.
 *
 * These configs define which functions to instrument and what channel
 * to emit events on. They are used by orchestrion-js to perform AST
 * transformation at build-time or load-time.
 *
 * NOTE: Channel names should NOT include the braintrust: prefix. The code-transformer
 * will prepend "orchestrion:openai:" to these names, resulting in final channel names like:
 * "orchestrion:openai:chat.completions.create"
 */
export const openaiConfigs: InstrumentationConfig[] = [
  // Chat Completions
  {
    channelName: "chat.completions.create",
    module: {
      name: "openai",
      versionRange: ">=4.0.0",
      filePath: "resources/chat/completions.mjs",
    },
    functionQuery: {
      className: "Completions",
      methodName: "create",
      kind: "Async",
    },
  },

  // Embeddings
  {
    channelName: "embeddings.create",
    module: {
      name: "openai",
      versionRange: ">=4.0.0",
      filePath: "resources/embeddings.mjs",
    },
    functionQuery: {
      className: "Embeddings",
      methodName: "create",
      kind: "Async",
    },
  },

  // Beta Chat Completions Parse
  {
    channelName: "beta.chat.completions.parse",
    module: {
      name: "openai",
      versionRange: ">=4.0.0",
      filePath: "resources/beta/chat/completions.mjs",
    },
    functionQuery: {
      className: "Completions",
      methodName: "parse",
      kind: "Async",
    },
  },

  // Moderations
  {
    channelName: "moderations.create",
    module: {
      name: "openai",
      versionRange: ">=4.0.0",
      filePath: "resources/moderations.mjs",
    },
    functionQuery: {
      className: "Moderations",
      methodName: "create",
      kind: "Async",
    },
  },

  // Beta Chat Completions Stream
  {
    channelName: "beta.chat.completions.stream",
    module: {
      name: "openai",
      versionRange: ">=4.0.0",
      filePath: "resources/beta/chat/completions.mjs",
    },
    functionQuery: {
      className: "Completions",
      methodName: "stream",
      kind: "Sync",
    },
  },

  // Responses API (v4.87.0+)
  {
    channelName: "responses.create",
    module: {
      name: "openai",
      versionRange: ">=4.87.0",
      filePath: "resources/responses/responses.mjs",
    },
    functionQuery: {
      className: "Responses",
      methodName: "create",
      kind: "Async",
    },
  },

  {
    channelName: "responses.stream",
    module: {
      name: "openai",
      versionRange: ">=4.87.0",
      filePath: "resources/responses/responses.mjs",
    },
    functionQuery: {
      className: "Responses",
      methodName: "stream",
      kind: "Sync",
    },
  },

  {
    channelName: "responses.parse",
    module: {
      name: "openai",
      versionRange: ">=4.87.0",
      filePath: "resources/responses/responses.mjs",
    },
    functionQuery: {
      className: "Responses",
      methodName: "parse",
      kind: "Async",
    },
  },
];
