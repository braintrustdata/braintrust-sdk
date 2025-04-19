export * from "./logger";
export * from "./functions/stream";
export * from "./functions/invoke";
export {
  BaseExperiment,
  Evaluator,
  EvalTask,
  Eval,
  EvalResult,
  EvalScorerArgs,
  EvalScorer,
  EvaluatorDef,
  EvaluatorFile,
  ReporterBody,
  Reporter,
  SpanContext,
  buildLocalSummary,
  reportFailures,
  runEvaluator,
  defaultErrorScoreHandler,
} from "./framework";
export * from "./framework2";
export * as graph from "./graph-framework";
export { LazyValue } from "./util";
export * from "./wrappers/oai";
export { wrapAISDKModel } from "./wrappers/ai-sdk";
export * from "./exports-types";
export type {
  ParentExperimentIds,
  ParentProjectLogIds,
  IdField,
  InputField,
  OtherExperimentLogFields,
  ExperimentLogPartialArgs,
  ExperimentLogFullArgs,
  LogFeedbackFullArgs,
  LogCommentFullArgs,
  CommentEvent,
  DatasetRecord,
} from "@braintrust/core";

// Wrap the anthropic client if it is installed.
let wrapAnthropic = function wrapAnthropic<T extends object>(anthropic: T): T {
  return anthropic;
};

try {
  if (require.resolve("@anthropic-ai/sdk")) {
    wrapAnthropic = require("./wrappers/anthropic").wrapAnthropic;
  }
} catch {
  // do nothing
}

export { wrapAnthropic };
