// Node exports: common exports + node-only exports

// eslint-disable-next-line no-restricted-syntax -- already enforced in exports-common.ts
export * from "./exports-common";

// framework includes a dependency on process.stdout.write which is node only
export {
  BaseExperiment,
  Evaluator,
  EvalTask,
  Eval,
  EvalHooks,
  EvalResult,
  EvalResultWithSummary,
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

// framework2 includes a dependency __filename which is node only
export type {
  CodeOpts,
  CreateProjectOpts,
  FunctionEvent,
  PromptContents,
  PromptDefinition,
  PromptDefinitionWithTools,
  PromptOpts,
  ScorerOpts,
} from "./framework2";

export {
  CodeFunction,
  CodePrompt,
  Project,
  ProjectNameIdMap,
  PromptBuilder,
  ScorerBuilder,
  ToolBuilder,
  projects,
  promptContentsSchema,
  promptDefinitionSchema,
  promptDefinitionToPromptData,
  promptDefinitionWithToolsSchema,
  toolFunctionDefinitionSchema,
} from "./framework2";

// wrapAISDKModel is being deprecated and was never exported for browser builds.
export { wrapAISDKModel } from "./wrappers/ai-sdk";
