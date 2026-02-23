import type { InstrumentationConfig } from "@apm-js-collab/code-transformer";

/**
 * Instrumentation configurations for the Google ADK (Agent Development Kit).
 *
 * These configs define which functions to instrument and what channel
 * to emit events on. They are used by orchestrion-js to perform AST
 * transformation at build-time or load-time.
 *
 * NOTE: Channel names should NOT include the braintrust: prefix. The code-transformer
 * will prepend "orchestrion:google-adk:" to these names, resulting in final channel names like:
 * "orchestrion:google-adk:runner.runAsync"
 */
export const googleADKConfigs: InstrumentationConfig[] = [
  // Runner.runAsync - Top-level orchestration entry point
  {
    channelName: "runner.runAsync",
    module: {
      name: "@google/adk",
      versionRange: ">=0.1.0",
      filePath: "dist/esm/index.js",
    },
    functionQuery: {
      className: "Runner",
      methodName: "runAsync",
      kind: "Async",
      isExportAlias: true,
    },
  },

  // BaseAgent.runAsync - Agent execution
  {
    channelName: "agent.runAsync",
    module: {
      name: "@google/adk",
      versionRange: ">=0.1.0",
      filePath: "dist/esm/index.js",
    },
    functionQuery: {
      className: "BaseAgent",
      methodName: "runAsync",
      kind: "Async",
      isExportAlias: true,
    },
  },

  // LlmAgent.callLlmAsync - Actual LLM call
  {
    channelName: "llm.callLlmAsync",
    module: {
      name: "@google/adk",
      versionRange: ">=0.1.0",
      filePath: "dist/esm/index.js",
    },
    functionQuery: {
      className: "LlmAgent",
      methodName: "callLlmAsync",
      kind: "Async",
      isExportAlias: true,
    },
  },

  // MCPTool.runAsync - MCP tool calls
  {
    channelName: "mcpTool.runAsync",
    module: {
      name: "@google/adk",
      versionRange: ">=0.1.0",
      filePath: "dist/esm/index.js",
    },
    functionQuery: {
      className: "MCPTool",
      methodName: "runAsync",
      kind: "Async",
      isExportAlias: true,
    },
  },
];
