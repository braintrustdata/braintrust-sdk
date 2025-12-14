// Common exports shared between browser and node builds
export { LazyValue } from "./util";

export type {
  AnyDataset,
  AttachmentParams,
  BackgroundLoggerOpts,
  BaseMetadata,
  ChatPrompt,
  CompiledPrompt,
  CompiledPromptParams,
  CompletionPrompt,
  ContextParentSpanIds,
  DataSummary,
  DatasetSummary,
  DefaultMetadataType,
  DefaultPromptArgs,
  EndSpanArgs,
  EvalCase,
  ExperimentSummary,
  Exportable,
  ExternalAttachmentParams,
  FullInitDatasetOptions,
  FullInitOptions,
  FullLoginOptions,
  InitDatasetOptions,
  InitLoggerOptions,
  InitOptions,
  LoadPromptOptions,
  LogOptions,
  LoginOptions,
  MetricSummary,
  ObjectMetadata,
  PromiseUnless,
  PromptRowWithId,
  ScoreSummary,
  SerializedBraintrustState,
  SetCurrentArg,
  Span,
  StartSpanArgs,
  WithTransactionId,
} from "./logger";

export {
  Attachment,
  BaseAttachment,
  BraintrustState,
  ContextManager,
  DEFAULT_FETCH_BATCH_SIZE,
  Dataset,
  ERR_PERMALINK,
  Experiment,
  ExternalAttachment,
  FailedHTTPResponse,
  JSONAttachment,
  Logger,
  LoginInvalidOrgError,
  NOOP_SPAN,
  NOOP_SPAN_PERMALINK,
  NoopSpan,
  Prompt,
  ReadonlyAttachment,
  ReadonlyExperiment,
  SpanImpl,
  TestBackgroundLogger,
  _exportsForTestingOnly,
  _internalGetGlobalState,
  _internalSetInitialState,
  currentExperiment,
  currentLogger,
  currentSpan,
  deepCopyEvent,
  deserializePlainStringAsJSON,
  flush,
  getContextManager,
  getPromptVersions,
  getSpanParentObject,
  init,
  initDataset,
  initExperiment,
  initLogger,
  loadPrompt,
  log,
  logError,
  login,
  loginToState,
  newId,
  permalink,
  renderMessage,
  renderPromptParams,
  setFetch,
  setMaskingFunction,
  spanComponentsToObjectId,
  startSpan,
  summarize,
  traceable,
  traced,
  updateSpan,
  withCurrent,
  withDataset,
  withExperiment,
  withLogger,
  withParent,
  wrapTraced,
} from "./logger";

export type { InvokeFunctionArgs, InvokeReturn } from "./functions/invoke";
export { initFunction, invoke } from "./functions/invoke";

export type { BraintrustStreamChunk } from "./functions/stream";
export {
  BraintrustStream,
  braintrustStreamChunkSchema,
  createFinalValuePassThroughStream,
  devNullWritableStream,
} from "./functions/stream";

export { IDGenerator, UUIDGenerator, getIdGenerator } from "./id-gen";

export {
  LEGACY_CACHED_HEADER,
  X_CACHED_HEADER,
  parseCachedHeader,
  wrapOpenAI,
  wrapOpenAIv4,
} from "./wrappers/oai";

export { wrapAISDK, BraintrustMiddleware } from "./wrappers/ai-sdk";
export { wrapAnthropic } from "./wrappers/anthropic";
export { wrapMastraAgent } from "./wrappers/mastra";
export { wrapClaudeAgentSDK } from "./wrappers/claude-agent-sdk/claude-agent-sdk";
export { wrapGoogleGenAI } from "./wrappers/google-genai";

export * as graph from "./graph-framework";
