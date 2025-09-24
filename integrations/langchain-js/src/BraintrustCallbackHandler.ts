import { isObject, SpanTypeAttribute } from "braintrust/util";
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
import { ToolMessage } from "@langchain/core/messages";
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
  private parent?: Span | (() => Span);
  private rootRunId?: string;
  private options: BraintrustCallbackHandlerOptions<IsAsyncFlush>;

  constructor(
    options?: Partial<BraintrustCallbackHandlerOptions<IsAsyncFlush>>,
  ) {
    super();

    this.spans = new Map();

    this.parent = options?.parent;

    this.options = {
      debug: options?.debug ?? false,
      excludeMetadataProps:
        options?.excludeMetadataProps ??
        /^(l[sc]_|langgraph_|__pregel_|checkpoint_ns)/,
      logger: options?.logger,
    };
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

    if (!parentRunId) {
      this.rootRunId = runId;
    }

    const tags = args.event?.tags;

    const spanAttributes = args.spanAttributes || {};
    spanAttributes.type =
      args.type || spanAttributes.type || SpanTypeAttribute.TASK;

    args.type = spanAttributes.type;

    args.event = {
      ...args.event,
      // Tags are only allowed at the root span.
      tags: undefined,
      metadata: {
        ...(tags ? { tags } : {}),
        ...args.event?.metadata,
        ...(this.options.debug ? { runId, parentRunId } : {}),
      },
    };

    const currentParent =
      (typeof this.parent === "function" ? this.parent() : this.parent) ??
      currentSpan();
    let parentSpan: Span;
    if (parentRunId && this.spans.has(parentRunId)) {
      parentSpan = this.spans.get(parentRunId)!;
    } else if (!Object.is(currentParent, NOOP_SPAN)) {
      parentSpan = currentParent;
    } else if (this.options.logger) {
      // If provided, use the logger as the parent span.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      parentSpan = this.options.logger as unknown as Span;
    } else {
      // Fallback to creating a new span.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      parentSpan = { startSpan } as unknown as Span;
    }

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
      throw new Error(
        `No span exists for runId ${runId} (this is likely a bug)`,
      );
    }

    const span = this.spans.get(runId)!;

    this.spans.delete(runId);
    if (runId === this.rootRunId) {
      this.rootRunId = undefined;
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
          ...this.cleanMetadata(metadata),
          ...extractCallArgs(
            llm,
            extraParams?.invocation_params || {},
            metadata,
          ),
        },
      },
    });
  }

  cleanMetadata(metadata?: Record<string, unknown>) {
    return (
      metadata &&
      Object.fromEntries(
        Object.entries(metadata).filter(
          ([key, _]) => !this.options.excludeMetadataProps.test(key),
        ),
      )
    );
  }

  async handleLLMError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        parentRunId,
        error: err.message,
        tags,
      });
    }
  }

  async handleLLMEnd(
    output: LLMResult | ChatResult,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      const { generations, ...metadata } = output;

      const metrics = getMetricsFromResponse(output);
      const modelName = getModelNameFromResponse(output);

      this.endSpan({
        runId,
        output: outputFromGenerations(generations),
        metrics,
        tags,
        metadata: cleanObject({
          ...this.cleanMetadata(metadata),
          model: modelName,
        }),
      });
    }
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
        input: inputFromMessages(messages),
        tags,
        metadata: cleanObject({
          ...this.cleanMetadata(metadata),
          ...extractCallArgs(
            llm,
            extraParams?.invocation_params || {},
            metadata,
          ),
          tools: extraParams?.invocation_params?.tools,
        }),
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
      return;
    }

    this.startSpan({
      runId,
      parentRunId,
      name: runName ?? chain?.name ?? chain.id.at(-1)?.toString() ?? "Chain",
      event: {
        input: inputFromChainValues(inputs),
        tags,
        metadata: {
          ...this.cleanMetadata(metadata),
          ...extractCallArgs(chain, {}, metadata),
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
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        error: err.toString(),
        tags,
      });
    }
  }

  async handleChainEnd(
    outputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: { inputs?: Record<string, unknown> },
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        tags,
        output: outputFromChainValues(outputs),
      });
    }
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
      event: {
        input: safeParseSerializedJson(input),
        tags,
        metadata: {
          ...this.cleanMetadata(metadata),
          ...extractCallArgs(tool, {}, metadata),
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
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        error: err.message,
        tags,
      });
    }
  }

  async handleToolEnd(
    output: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        output: outputFromToolOutput(output),
        tags,
      });
    }
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
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        output: action,
        tags,
      });
    }
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
          ...this.cleanMetadata(metadata),
          ...extractCallArgs(retriever, {}, metadata),
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
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        output: documents,
        tags,
      });
    }
  }

  async handleRetrieverError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        error: err.message,
        tags,
      });
    }
  }
}

const extractCallArgs = (
  llm: Serialized,
  invocationParams: Record<string, unknown>,
  metadata?: Record<string, unknown>,
): Record<string, unknown> => {
  // NOTE: These vary by langchain model used. We try to normalize them here.
  const args = cleanObject({
    model: pick(invocationParams?.model, metadata?.ls_model_name, llm.name),
    temperature: pick(invocationParams?.temperature, metadata?.ls_temperature),
    top_p: pick(invocationParams?.top_p, invocationParams?.topP),
    top_k: pick(invocationParams?.top_k, invocationParams?.topK),
    max_tokens: pick(
      invocationParams?.max_tokens,
      invocationParams?.maxOutputTokens,
    ),
    frequency_penalty: invocationParams?.frequency_penalty,
    presence_penalty: invocationParams?.presence_penalty,
    response_format: invocationParams?.response_format,
    tool_choice: invocationParams?.tool_choice,
    function_call: invocationParams?.function_call,
    n: invocationParams?.n,
    stop: pick(invocationParams?.stop, invocationParams?.stop_sequence),
  });

  // Failsafe let's provide the invocation params as is
  return !Object.keys(args).length ? invocationParams : args;
};

const pick = (...values: unknown[]) =>
  values.find((value) => value !== undefined && value !== null);

const outputFromGenerations = (
  generations: Generation[][] | ChatGeneration[],
) => {
  const parsed = generations.flatMap((batch) => {
    return Array.isArray(batch)
      ? batch.map(parseGeneration)
      : parseGeneration(batch);
  });

  return parsed;
};

const parseGeneration = (generation: Generation | ChatGeneration) => {
  if ("message" in generation) {
    return getMessageContent(generation.message);
  }

  if (generation.text) {
    return generation.text;
  }

  // Give up!
};

const inputFromMessages = (messages: BaseMessage[][]) => {
  const parsed = messages.flatMap((batch) => batch.map(getMessageContent));
  return parsed;
};

const getMessageContent = (message: BaseMessage) => {
  let role = message.name ?? message.getType();

  if (message.getType() === "human") {
    role = "user";
  } else if (message.getType() === "ai") {
    role = "assistant";
  } else if (message.getType() === "system") {
    role = "system";
  }

  return cleanObject({
    content: message.content,
    role,
    // @ts-expect-error Message may be any BaseMessage concrete implementation
    tool_calls: message.tool_calls,
    // @ts-expect-error Message may be any ToolMessage
    status: message.status,
    // @ts-expect-error Message may be any ToolMessage
    artifact: message.artifact,
  });
};

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

const safeParseSerializedJson = (input: string) => {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

const outputFromToolOutput = (output: unknown | ToolMessage) =>
  output instanceof ToolMessage ? getMessageContent(output) : undefined;

const outputFromChainValues = (output: unknown) => {
  const parsed = (Array.isArray(output) ? output : [output]).flatMap(
    parseChainValue,
  );
  return parsed.length === 1 ? parsed[0] : parsed;
};

/**
 * Serialized output frsom Langchain may be multiple different types.
 * This attempts to normalize them. We'll likely miss some cases!
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseChainValue = (output: any): any => {
  if (typeof output === "string") {
    return output;
  }

  if (!output) {
    return output;
  }

  if (output.content) {
    return output.content;
  }

  if (output.messages) {
    return output.messages.map(parseChainValue);
  }

  if (output.value) {
    return output.value;
  }

  if (output.kwargs) {
    return parseChainValue(output.kwargs);
  }

  // XXX: RunnableMap returns an object with keys for each sequence
  if (typeof output === "object" && output) {
    return Object.fromEntries(
      Object.entries(output).map(([key, value]) => [
        key,
        parseChainValue(value),
      ]),
    );
  }

  // Give up! Let's assume the user will use the raw output.
  return output;
};

const inputFromChainValues = (inputs: ChainValues) => {
  const parsed = (Array.isArray(inputs) ? inputs : [inputs]).flatMap(
    parseChainValue,
  );
  return parsed.length === 1 ? parsed[0] : parsed;
};

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
