import type { AISDKAgentClass, AISDKNamespaceBase } from "./ai-sdk-common";

export interface AISDKV5 extends AISDKNamespaceBase {
  Agent?: AISDKAgentClass;
  Experimental_Agent?: AISDKAgentClass;
}
