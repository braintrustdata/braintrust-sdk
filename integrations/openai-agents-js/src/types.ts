import { Logger } from "braintrust";
import type {
  SpanData,
  AgentSpanData,
  FunctionSpanData,
  GenerationSpanData,
  ResponseSpanData,
  HandoffSpanData,
  CustomSpanData,
  GuardrailSpanData,
} from "@openai/agents-core/dist/tracing/spans";

import type { Trace, Span } from "@openai/agents";

export enum SpanType {
  AGENT = "agent",
  RESPONSE = "response",
  FUNCTION = "function",
  HANDOFF = "handoff",
  GUARDRAIL = "guardrail",
  GENERATION = "generation",
  CUSTOM = "custom",
}

export type AgentsTrace = Trace;

export type AgentsSpan = Span<SpanData>;

export type SpanInput =
  | string
  | Array<Record<string, unknown>>
  | Record<string, unknown>[];

export type SpanOutput =
  | string
  | Array<Record<string, unknown>>
  | Record<string, unknown>;

export type TraceMetadata = {
  firstInput: SpanInput | null;
  lastOutput: SpanOutput | null;
};

export interface OpenAIAgentsTraceProcessorOptions {
  logger?: Logger<any>;
  maxTraces?: number;
}

// Type guard functions
export function isResponseSpanData(
  spanData: SpanData,
): spanData is ResponseSpanData {
  return spanData.type === SpanType.RESPONSE;
}

export function isGenerationSpanData(
  spanData: SpanData,
): spanData is GenerationSpanData {
  return spanData.type === SpanType.GENERATION;
}

export function isAgentSpanData(spanData: SpanData): spanData is AgentSpanData {
  return spanData.type === SpanType.AGENT;
}

export function isFunctionSpanData(
  spanData: SpanData,
): spanData is FunctionSpanData {
  return spanData.type === SpanType.FUNCTION;
}

export function isHandoffSpanData(
  spanData: SpanData,
): spanData is HandoffSpanData {
  return spanData.type === SpanType.HANDOFF;
}

export function isGuardrailSpanData(
  spanData: SpanData,
): spanData is GuardrailSpanData {
  return spanData.type === SpanType.GUARDRAIL;
}

export function isCustomSpanData(
  spanData: SpanData,
): spanData is CustomSpanData {
  return spanData.type === SpanType.CUSTOM;
}
