import type { InstrumentationConfig } from "../orchestrion-js";
import { livekitChannels } from "../../instrumentation/plugins/livekit-channels";
// Private lifecycle hooks: widen only after validating the supported release matrix.
export const livekitConfigs: InstrumentationConfig[] = [
  ["pipeline", "agent_activity", "AgentActivity", "_pipelineReplyTaskImpl"],
  ["conversation", "agent_session", "AgentSession", "_conversationItemAdded"],
  ["userCompleted", "agent_activity", "AgentActivity", "userTurnCompleted"],
  [
    "realtime",
    "agent_activity",
    "AgentActivity",
    "_realtimeGenerationTaskImpl",
  ],
  ["start", "agent_session", "AgentSession", "_startImpl"],
  ["close", "agent_session", "AgentSession", "closeImpl"],
  ["output", "agent_session", "AgentSession", "onAudioOutputChanged"],
  ["input", "agent_activity", "AgentActivity", "attachAudioInput"],
  ["activity", "agent_activity", "AgentActivity", "_startSessionImpl"],
  ["userTurn", "agent_activity", "AgentActivity", "onEndOfTurn"],
].map(([channel, file, className, methodName]) => ({
  channelName:
    livekitChannels[channel as keyof typeof livekitChannels].channelName,
  module: {
    name: "@livekit/agents",
    versionRange: ">=1.9.1 <1.10.0",
    filePath: `dist/voice/${file}.js`,
  },
  functionQuery: { className, methodName },
}));

// These factories create the async inference workers inside the scoped call.
// Suppressing here leaves tool execution and other session work instrumented.
for (const functionName of ["performLLMInference", "performTTSInference"]) {
  livekitConfigs.push({
    channelName: livekitChannels.inference.channelName,
    module: {
      name: "@livekit/agents",
      versionRange: ">=1.9.1 <1.10.0",
      filePath: "dist/voice/generation.js",
    },
    functionQuery: { functionName },
  });
}

// Observe the native tracer at its stable function boundary; preserve providers.
for (const methodName of [
  "startSpan",
  "startActiveSpan",
  "startActiveSpanSync",
] as const) {
  livekitConfigs.push({
    channelName: livekitChannels.trace.channelName,
    module: {
      name: "@livekit/agents",
      versionRange: ">=1.9.1 <1.10.0",
      filePath: "dist/telemetry/traces.js",
    },
    functionQuery: { className: "DynamicTracer", methodName },
  });
}
livekitConfigs.push({
  channelName: livekitChannels.provider.channelName,
  module: {
    name: "@livekit/agents",
    versionRange: ">=1.9.1 <1.10.0",
    filePath: "dist/telemetry/traces.js",
  },
  functionQuery: { functionName: "setTracerProvider" },
});
