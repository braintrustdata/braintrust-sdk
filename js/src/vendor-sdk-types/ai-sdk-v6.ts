import type { AISDKAgentClass, AISDKNamespaceBase } from "./ai-sdk-common";

export interface AISDKV6 extends AISDKNamespaceBase {
  Agent?: AISDKAgentClass;
  Experimental_Agent?: AISDKAgentClass;
  ToolLoopAgent?: AISDKAgentClass;
}
