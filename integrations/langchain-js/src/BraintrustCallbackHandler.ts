import {
  BaseCallbackHandler,
  BaseCallbackHandlerInput,
} from "@langchain/core/callbacks/base";
import { AgentAction, AgentFinish } from "@langchain/core/dist/agents";
import { DocumentInterface } from "@langchain/core/dist/documents/document";
import { Serialized } from "@langchain/core/dist/load/serializable";
import { BaseMessage } from "@langchain/core/dist/messages/base";
import {
  ChatGeneration,
  ChatResult,
  Generation,
  LLMResult,
} from "@langchain/core/dist/outputs";
import { ChainValues } from "@langchain/core/dist/utils/types";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  currentSpan,
  ExperimentLogPartialArgs,
  initLogger,
  Logger,
  NOOP_SPAN,
  Span,
  startSpan,
  StartSpanArgs,
} from "braintrust";

/**
 * A Braintrust tracer for LangChain.js that logs LLM calls, chains, and tools.
 */
export interface BraintrustCallbackHandlerOptions<
  IsAsyncFlush extends boolean,
> {
  logger?: Logger<IsAsyncFlush> | Span;
  debug: boolean;
  /** The parent span to associate for this callback handler. */
  parent?: Span | (() => Span);
  excludeMetadataProps: RegExp;
}

export class BraintrustCallbackHandler<IsAsyncFlush extends boolean>
  extends BaseCallbackHandler
  implements BaseCallbackHandlerInput
{
  name = "BraintrustCallbackHandler";
  private spans: Map<string, Span>;
  private skippedRuns: Set<string>;
  private parent?: Span | (() => Span);
  private rootRunId?: string;
  private rootSpanContext: Map<string, Span>;
  private capturedContext?: Span;
  private options: BraintrustCallbackHandlerOptions<IsAsyncFlush>;

  constructor(
    options?: Partial<BraintrustCallbackHandlerOptions<IsAsyncFlush>>,
  ) {
    super();
    this.skippedRuns = new Set();
    this.spans = new Map();
    this.rootSpanContext = new Map();

    this.parent = options?.parent;

    this.options = {
      debug: options?.debug ?? false,
      excludeMetadataProps:
        options?.excludeMetadataProps ??
        /^(l[sc]_|langgraph_|__pregel_|checkpoint_ns)/,
      logger: options?.logger,
    };

    // Capture the current span context at construction time if no explicit
    // logger or parent is provided. This ensures correct context in concurrent scenarios.
    if (!this.parent && !this.options.logger) {
      this.capturedContext = currentSpan();
    }
  }

  protected startSpan({
    runId,
    parentRunId,
    ...args
  }: StartSpanArgs & {
    runId: string;
    parentRunId?: string;
  }) {
    if (this.spans.has(runId)) {
      // XXX: See graph test case of an example where this _may_ be intended.
      console.warn(
        `Span already exists for runId ${runId} (this is likely a bug)`,
      );
      return;
    }

    if (!parentRunId || parentRunId === runId) {
      this.rootRunId = runId;

      // Capture the current span context once per root run to avoid
      // async context issues in concurrent scenarios
      if (!this.rootSpanContext.has(runId)) {
        const contextSpan = this.parent
          ? typeof this.parent === "function"
            ? this.parent()
            : this.parent
          : this.options.logger
            ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              (this.options.logger as unknown as Span)
            : this.capturedContext ?? currentSpan();

        this.rootSpanContext.set(runId, contextSpan);
      }
    }

    const tags = args.event?.tags;

    const spanAttributes = args.spanAttributes || {};
    spanAttributes.type = args.type || spanAttributes.type || "task";

    args.type = spanAttributes.type;

    let parentSpan: Span;
    if (parentRunId && this.spans.has(parentRunId)) {
      // Use the parent span from the spans map for child operations
      parentSpan = this.spans.get(parentRunId)!;
    } else {
      // For root spans, use the captured context for this root run
      // This avoids async context issues in concurrent scenarios
      const rootId = this.rootRunId || runId;
      const capturedContext = this.rootSpanContext.get(rootId);

      if (capturedContext) {
        // Use the captured context, even if it's NOOP_SPAN
        // This ensures NOOP_SPAN is respected when explicitly provided
        parentSpan = capturedContext;
      } else {
        // Fallback to creating a new span.
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        parentSpan = { startSpan } as unknown as Span;
      }
    }

    args.event = {
      ...args.event,
      // Tags are only allowed at the root span.
      tags: undefined,
      metadata: {
        ...(tags ? { tags } : {}),
        ...args.event?.metadata,
        braintrust: {
          integration_name: "langchain-js",
          integration_version: "0.2.0", // TODO: grab from package.json?
          // TODO: sdk_version,
          sdk_language: "javascript",
        },
        run_id: runId,
        parent_run_id: parentRunId,
        ...(this.options.debug ? { runId, parentRunId } : {}),
      },
    };

    let span = parentSpan.startSpan(args);

    if (
      // If the original logger is NOOP_SPAN, we don't need bother folks to configure it.
      !Object.is(this.options.logger, NOOP_SPAN) &&
      Object.is(span, NOOP_SPAN)
    ) {
      console.warn(
        "Braintrust logging not configured. Pass a `logger`, call `initLogger`, or run an experiment to configure Braintrust logging. Setting up a default.",
      );
      span = initLogger().startSpan(args);
    }

    this.spans.set(runId, span);
  }

  protected endSpan({
    runId,
    parentRunId,
    tags,
    metadata,
    ...args
  }: ExperimentLogPartialArgs & { runId: string; parentRunId?: string }): void {
    if (!this.spans.has(runId)) {
      return;
    }

    if (this.skippedRuns.has(runId)) {
      this.skippedRuns.delete(runId);
      return;
    }

    const span = this.spans.get(runId)!;

    this.spans.delete(runId);
    if (runId === this.rootRunId) {
      this.rootRunId = undefined;
    }

    // Clean up root span context when root run ends
    if (this.rootSpanContext.has(runId)) {
      this.rootSpanContext.delete(runId);
    }

    span.log({ ...args, metadata: { tags, ...metadata } });
    span.end();
  }

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: {
      options: RunnableConfig;
      invocation_params?: Record<string, unknown>;
      batch_size: number;
      cache?: boolean;
    },
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? llm.name ?? llm.id.at(-1)?.toString() ?? "LLM",
      type: "llm",
      event: {
        input: prompts,
        tags,
        metadata: {
          serialized: llm,
          name: runName,
          metadata,
          ...extraParams,
        },
      },
    });
  }

  async handleLLMError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.endSpan({
      runId,
      parentRunId,
      error: err,
      tags,
    });
  }

  async handleLLMEnd(
    output: LLMResult | ChatResult,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    const metrics = getMetricsFromResponse(output);
    const modelName = getModelNameFromResponse(output);

    this.endSpan({
      runId,
      output,
      metrics,
      tags,
      metadata: {
        model: modelName,
      },
    });
  }

  async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: {
      options: RunnableConfig;
      invocation_params?: Record<string, unknown>;
      batch_size: number;
      cache?: boolean;
    },
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? llm.name ?? llm.id.at(-1)?.toString() ?? "Chat Model",
      type: "llm",
      event: {
        input: messages,
        tags,
        metadata: {
          serialized: llm,
          name: runName,
          metadata,
          ...extraParams,
        },
      },
    });
  }

  async handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string,
  ): Promise<void> {
    if (tags?.includes("langsmith:hidden")) {
      this.skippedRuns.add(runId);
      return;
    }

    const resolvedName =
      runName ?? chain?.name ?? chain.id.at(-1)?.toString() ?? "Chain";

    this.startSpan({
      runId,
      parentRunId,
      name: resolvedName,
      event: {
        input: inputs,
        tags,
        metadata: {
          serialized: chain,
          name: runName,
          metadata,
          run_type: runType,
        },
      },
    });
  }

  async handleChainError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: {
      inputs?: Record<string, unknown>;
    },
  ): Promise<void> {
    this.endSpan({
      runId,
      error: err,
      tags,
      metadata: kwargs,
    });
  }

  async handleChainEnd(
    outputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: { inputs?: Record<string, unknown> },
  ): Promise<void> {
    this.endSpan({
      runId,
      tags,
      output: outputs,
      metadata: { ...kwargs },
    });
  }

  async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? tool.name ?? tool.id.at(-1)?.toString() ?? "Tool",
      type: "llm",
      event: {
        input: safeJsonParse(input),
        tags,
        metadata: {
          metadata,
          serialized: tool,
          input_str: input,
          input: safeJsonParse(input),
          name: runName,
        },
      },
    });
  }

  async handleToolError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.endSpan({
      runId,
      error: err,
      tags,
    });
  }

  async handleToolEnd(
    output: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.endSpan({
      runId,
      output,
      tags,
    });
  }

  async handleAgentAction(
    action: AgentAction,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      type: "llm",
      name: action.tool,
      event: {
        input: action,
        tags,
      },
    });
  }

  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.endSpan({
      runId,
      output: action,
      tags,
    });
  }

  async handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string,
  ): Promise<void> {
    this.startSpan({
      runId,
      parentRunId,
      name:
        name ??
        retriever.name ??
        retriever.id.at(-1)?.toString() ??
        "Retriever",
      type: "function",
      event: {
        input: query,
        tags,
        metadata: {
          serialized: retriever,
          metadata,
          name,
        },
      },
    });
  }

  async handleRetrieverEnd(
    documents: DocumentInterface[],
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.endSpan({
      runId,
      output: documents,
      tags,
    });
  }

  async handleRetrieverError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.endSpan({
      runId,
      error: err,
      tags,
    });
  }
}

const cleanObject = (obj: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(obj).filter(([key, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      if (isObject(value) && Object.keys(value).length === 0) {
        return false;
      }
      return true;
    }),
  );

const walkGenerations = (
  response: LLMResult | ChatResult,
): (Generation | ChatGeneration)[] => {
  const result: (Generation | ChatGeneration)[] = [];
  const generations = response.generations || [];
  for (const batch of generations) {
    if (Array.isArray(batch)) {
      for (const generation of batch) {
        result.push(generation);
      }
    } else {
      result.push(batch);
    }
  }
  return result;
};

const getModelNameFromResponse = (
  response: LLMResult | ChatResult,
): string | undefined => {
  let modelName: string | undefined;

  // First, try to get model name from message response_metadata
  for (const generation of walkGenerations(response)) {
    if ("message" in generation && generation.message) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message: any = generation.message;
      const responseMetadata = message.response_metadata;
      if (responseMetadata && typeof responseMetadata === "object") {
        modelName = responseMetadata.model_name || responseMetadata.model;
      }
      if (modelName) break;
    }
  }

  // Fallback to llmOutput
  if (!modelName) {
    const llmOutput = response.llmOutput || {};
    modelName = llmOutput.model_name || llmOutput.model;
  }

  return modelName;
};

const getMetricsFromResponse = (response: LLMResult | ChatResult) => {
  const metrics: Record<string, number> = {};

  // First, try to get metrics from message usage_metadata
  for (const generation of walkGenerations(response)) {
    if ("message" in generation && generation.message) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message: any = generation.message;
      const usageMetadata = message.usage_metadata;
      if (usageMetadata && typeof usageMetadata === "object") {
        const extracted = cleanObject({
          total_tokens: usageMetadata.total_tokens,
          prompt_tokens: usageMetadata.input_tokens,
          completion_tokens: usageMetadata.output_tokens,
        });
        Object.assign(metrics, extracted);
        break;
      }
    }
  }

  // Fallback to llmOutput if no metrics found
  if (!Object.keys(metrics).length) {
    const llmOutput = response.llmOutput || {};
    const tokenUsage = llmOutput.tokenUsage || llmOutput.estimatedTokens || {};

    return cleanObject({
      total_tokens: tokenUsage.totalTokens,
      prompt_tokens: tokenUsage.promptTokens,
      completion_tokens: tokenUsage.completionTokens,
    });
  }

  return metrics;
};

const safeJsonParse = (input: string) => {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

function isObject(object: unknown) {
  return object != null && typeof object === "object";
}
