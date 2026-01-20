export const spanTypeAttributeValues = [
  "llm",
  "score",
  "function",
  "eval",
  "task",
  "tool",
  "review",
  "automation",
  "facet",
  "preprocessor",
  "classifier",
] as const;

// DEPRECATED: Use `spanTypeAttributeValues` instead
export enum SpanTypeAttribute {
  LLM = "llm",
  SCORE = "score",
  FUNCTION = "function",
  EVAL = "eval",
  TASK = "task",
  TOOL = "tool",
  REVIEW = "review",
  AUTOMATION = "automation",
  FACET = "facet",
  PREPROCESSOR = "preprocessor",
  CLASSIFIER = "classifier",
}

export type SpanType = (typeof spanTypeAttributeValues)[number];

export const spanPurposeAttributeValues = ["scorer"] as const;

export type SpanPurpose = (typeof spanPurposeAttributeValues)[number];
