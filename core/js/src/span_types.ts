export const spanTypeAttributeValues = [
  "llm",
  "score",
  "function",
  "eval",
  "task",
  "tool",
] as const;

// DEPRECATED: Use `spanTypeAttributeValues` instead
export enum SpanTypeAttribute {
  LLM = "llm",
  SCORE = "score",
  FUNCTION = "function",
  EVAL = "eval",
  TASK = "task",
  TOOL = "tool",
}

export type SpanType = typeof spanTypeAttributeValues[number];
