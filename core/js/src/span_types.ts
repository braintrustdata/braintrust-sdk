export enum SpanTypeAttribute {
  LLM = "llm",
  SCORE = "score",
  FUNCTION = "function",
  EVAL = "eval",
  TASK = "task",
  TOOL = "tool",
}

// Make SpanType any of the values of SpanTypeAttribute, eg llm, score, function, eval, task, tool
export type SpanType = SpanTypeAttribute[keyof SpanTypeAttribute];
