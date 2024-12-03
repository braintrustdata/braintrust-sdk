import { ExperimentLogPartialArgs } from "@braintrust/core";
import {
  BaseCallbackHandler,
  BaseCallbackHandlerInput,
  HandleLLMNewTokenCallbackFields,
  NewTokenIndices,
} from "@langchain/core/callbacks/base";
import { AgentAction, AgentFinish } from "@langchain/core/dist/agents";
import { DocumentInterface } from "@langchain/core/dist/documents/document";
import { Serialized } from "@langchain/core/dist/load/serializable";
import { BaseMessage } from "@langchain/core/dist/messages/base";
import { LLMResult } from "@langchain/core/dist/outputs";
import { ChainValues } from "@langchain/core/dist/utils/types";
import {
  currentLogger,
  currentSpan,
  Logger,
  NOOP_SPAN,
  Span,
  StartSpanArgs,
} from "../../../js/src/logger";

/**
 * A Braintrust tracer for LangChain.js that logs LLM calls, chains, and tools
 */
export class BraintrustTracer<IsAsyncFlush extends boolean = false>
  extends BaseCallbackHandler
  implements BaseCallbackHandlerInput
{
  name = "BraintrustTracer";
  private spans: Map<string, Span>;
  private logger: Logger<IsAsyncFlush>;
  private stack: [string, string][] = [];
  private position: number = 0;

  constructor(logger?: Logger<IsAsyncFlush>) {
    super();

    this.spans = new Map();

    logger = logger ?? currentLogger();
    if (!logger) {
      throw new Error("No logger provided or available.");
    }

    this.logger = logger;
  }

  private startSpan({
    runId,
    parentRunId,
    from,
    ...args
  }: StartSpanArgs & {
    runId: string;
    parentRunId?: string;
    from: string;
  }): Span {
    if (this.spans.has(runId)) {
      throw new Error(
        `Span already exists for runId ${runId} (this is likely a bug)`,
      );
    }

    const currentParent = currentSpan();
    let parentSpan: Span;
    if (parentRunId && this.spans.has(parentRunId)) {
      parentSpan = this.spans.get(parentRunId)!;
    } else if (!Object.is(currentParent, NOOP_SPAN)) {
      parentSpan = currentParent;
    } else {
      // eslint-disable-next-line
      parentSpan = this.logger as any;
    }

    const span = parentSpan.startSpan(args);

    this.spans.set(runId, span);

    this.stack.push([from, runId]);
    this.position++;
    return span;
  }

  private endSpan({
    runId,
    ...args
  }: ExperimentLogPartialArgs & { runId: string }): void {
    if (!this.spans.has(runId)) {
      throw new Error(
        `No span exists for runId ${runId} (this is likely a bug)`,
      );
    }

    const span = this.spans.get(runId)!;
    this.spans.delete(runId);

    span.log(args);
    span.end();

    this.stack.pop();
    this.position--;
  }

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    this.startSpan({
      from: "handleLLMStart",
      runId,
      parentRunId,
      name: runName ?? llm.id.at(-1)?.toString() ?? "LLM",
      type: "llm",
      event: {
        // TODO: improve logging
        input: prompts,
        metadata: { tags, ...metadata, ...extraParams },
      },
    });
  }

  async handleLLMNewToken(
    token: string,
    idx: NewTokenIndices,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    fields?: HandleLLMNewTokenCallbackFields,
  ): Promise<void> {
    // TODO: implement
  }

  async handleLLMError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({ runId, error: err.message, metadata: { tags } });
    }
  }

  async handleLLMEnd(
    output: LLMResult,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      const tokenUsage = output.llmOutput?.tokenUsage || {};
      this.endSpan({
        runId,
        metadata: { tags },

        // TODO: improved logging
        output: output.generations,
        metrics: {
          tokens: tokenUsage.totalTokens,
          prompt_tokens: tokenUsage.promptTokens,
          completion_tokens: tokenUsage.completionTokens,
        },
      });
    }
  }

  async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void> {
    this.startSpan({
      from: "handleChatModelStart",
      runId,
      parentRunId,
      name: runName ?? llm.id.at(-1)?.toString() ?? "Chat Model",
      event: {
        // TODO: improve logging
        input: messages.flatMap((batch) =>
          batch.map((message) => message.toDict()),
        ),
        metadata: { tags, ...metadata, ...extraParams },
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
    this.startSpan({
      from: "handleChainStart",
      runId,
      parentRunId,
      name: runName ?? chain.id.at(-1)?.toString() ?? "Chain",
      // TODO: improve logging
      event: {
        input: inputs,
        metadata: { tags, ...metadata },
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
        error: err.message,
        metadata: { tags },
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
        metadata: { tags },
        output: outputs,
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
      from: "handleToolStart",
      runId,
      parentRunId,
      name: runName ?? tool.id.at(-1)?.toString() ?? "Tool",
      event: { input, metadata: { tags, ...metadata } },
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
        metadata: { tags },
      });
    }
  }

  async handleToolEnd(
    output: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    if (this.spans.has(runId)) {
      this.endSpan({
        runId,
        output,
        metadata: { tags },
      });
    }
  }

  async handleAgentAction(
    action: AgentAction,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    // TODO: implement
  }

  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    // TODO: implement
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
    // TODO: implement
  }

  async handleRetrieverEnd(
    documents: DocumentInterface[],
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    // TODO: implement
  }

  async handleRetrieverError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    // TODO: implement
  }

  async handleCustomEvent(
    eventName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    runId: string,
    tags?: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, any>,
  ): Promise<void> {
    // TODO: implement
  }
}
