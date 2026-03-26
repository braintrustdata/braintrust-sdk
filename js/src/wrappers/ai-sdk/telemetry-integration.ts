/* eslint-disable @typescript-eslint/no-explicit-any */

import { startSpan, withCurrent, type Span } from "../../logger";
import { SpanTypeAttribute } from "../../../util";
import { extractTokenMetrics } from "./ai-sdk";

/**
 * Braintrust-specific metadata that can be passed through
 * `experimental_telemetry.metadata.braintrust` on AI SDK calls.
 */
export interface BraintrustTelemetryMetadata {
  /** Custom span name for the root Braintrust span. */
  name?: string;
  /** Additional metadata to attach to the Braintrust span. */
  metadata?: Record<string, unknown>;
  /** Custom span attributes (e.g., `{ type: "function" }`). */
  spanAttributes?: Record<string, unknown>;
}

/**
 * Internal state tracked per AI SDK call (keyed by callId).
 */
interface CallState {
  /** The operation type (e.g. 'ai.generateText', 'ai.streamText'). */
  operationId: string;
  /** The root Braintrust span for this call. */
  rootSpan: Span;
  /** Current step span (if in a step). */
  stepSpan?: Span;
  /** Tool spans keyed by toolCallId. */
  toolSpans: Map<string, Span>;
  /** Whether we've received the first stream chunk. */
  receivedFirstChunk: boolean;
  /** Start time for stream timing. */
  startTime: number;
  /** Braintrust-specific metadata from telemetry settings. */
  braintrustMeta?: BraintrustTelemetryMetadata;
}

/**
 * Extracts Braintrust-specific metadata from the telemetry metadata object.
 * Users pass this via `experimental_telemetry.metadata.braintrust`.
 */
function extractBraintrustMeta(
  metadata: Record<string, unknown> | undefined,
): BraintrustTelemetryMetadata | undefined {
  if (!metadata) return undefined;
  const bt = metadata.braintrust;
  if (!bt || typeof bt !== "object") return undefined;
  return bt as BraintrustTelemetryMetadata;
}

/**
 * Converts an AI SDK usage object to Braintrust metrics format.
 */
function usageToMetrics(
  usage: Record<string, unknown> | undefined,
): Record<string, number> {
  if (!usage) return {};
  return extractTokenMetrics({ usage } as any);
}

/**
 * Derives a default span name from the operation ID.
 * e.g. 'ai.generateText' -> 'generateText', 'ai.streamText' -> 'streamText'
 */
function defaultSpanName(operationId: string): string {
  const dotIndex = operationId.lastIndexOf(".");
  return dotIndex >= 0 ? operationId.slice(dotIndex + 1) : operationId;
}

/**
 * Serializes messages for logging input. Truncates to avoid massive payloads.
 */
function serializeMessages(messages: unknown): unknown {
  if (!messages) return undefined;
  if (!Array.isArray(messages)) return messages;
  return messages;
}

/**
 * Builds the input object for the root span from an onStart event.
 */
function buildRootInput(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (event.system !== undefined) input.system = event.system;
  if (event.prompt !== undefined) input.prompt = event.prompt;
  if (event.messages !== undefined)
    input.messages = serializeMessages(event.messages);
  return input;
}

/**
 * Builds the input object for a step span from an onStepStart event.
 */
function buildStepInput(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (event.messages !== undefined)
    input.messages = serializeMessages(event.messages);
  return input;
}

/**
 * Serializes step result output for logging.
 */
function buildStepOutput(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (event.text !== undefined) output.text = event.text;
  if (
    event.toolCalls !== undefined &&
    Array.isArray(event.toolCalls) &&
    event.toolCalls.length > 0
  ) {
    output.toolCalls = event.toolCalls;
  }
  if (
    event.toolResults !== undefined &&
    Array.isArray(event.toolResults) &&
    event.toolResults.length > 0
  ) {
    output.toolResults = event.toolResults;
  }
  if (event.finishReason !== undefined)
    output.finishReason = event.finishReason;
  if (event.usage !== undefined) output.usage = event.usage;
  return output;
}

/**
 * Serializes finish result output for logging on the root span.
 */
function buildFinishOutput(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (event.text !== undefined) output.text = event.text;
  if (
    event.toolCalls !== undefined &&
    Array.isArray(event.toolCalls) &&
    event.toolCalls.length > 0
  ) {
    output.toolCalls = event.toolCalls;
  }
  if (
    event.toolResults !== undefined &&
    Array.isArray(event.toolResults) &&
    event.toolResults.length > 0
  ) {
    output.toolResults = event.toolResults;
  }
  if (event.finishReason !== undefined)
    output.finishReason = event.finishReason;
  if (event.totalUsage !== undefined) output.totalUsage = event.totalUsage;
  else if (event.usage !== undefined) output.usage = event.usage;
  return output;
}

/**
 * Serializes an error for logging.
 */
function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      // fall through
    }
  }
  return String(error);
}

/**
 * A Braintrust `TelemetryIntegration` for the AI SDK (v7+).
 *
 * This integration creates Braintrust spans from the AI SDK's lifecycle events
 * for `generateText` and `streamText`. It replaces the `wrapAISDK()` approach
 * with a first-class telemetry integration pattern.
 *
 * ## Usage
 *
 * ### Global registration (recommended)
 *
 * ```typescript
 * import { registerTelemetryIntegration } from "ai";
 * import { BraintrustTelemetryIntegration } from "braintrust";
 *
 * registerTelemetryIntegration(new BraintrustTelemetryIntegration());
 * ```
 *
 * ### Per-call registration
 *
 * ```typescript
 * import { generateText } from "ai";
 * import { BraintrustTelemetryIntegration } from "braintrust";
 *
 * const result = await generateText({
 *   model: openai("gpt-4"),
 *   prompt: "Hello world",
 *   experimental_telemetry: {
 *     integrations: [new BraintrustTelemetryIntegration()],
 *     metadata: {
 *       braintrust: {
 *         name: "my-custom-span-name",
 *         metadata: { user: "test" },
 *       },
 *     },
 *   },
 * });
 * ```
 */
export class BraintrustTelemetryIntegration {
  private callStates = new Map<string, CallState>();

  private getState(callId: string): CallState | undefined {
    return this.callStates.get(callId);
  }

  private cleanup(callId: string): void {
    this.callStates.delete(callId);
  }

  /**
   * Called when an AI SDK operation begins (generateText or streamText).
   */
  onStart = (event: any): void => {
    const operationId: string = event.operationId ?? "unknown";

    // Only handle generateText and streamText
    if (operationId !== "ai.generateText" && operationId !== "ai.streamText") {
      return;
    }

    const braintrustMeta = extractBraintrustMeta(
      event.metadata as Record<string, unknown> | undefined,
    );

    const spanName = braintrustMeta?.name ?? defaultSpanName(operationId);

    const { model: modelId, provider } = extractModelInfo(event);

    const rootSpan = startSpan({
      name: spanName,
      spanAttributes: {
        type: SpanTypeAttribute.LLM,
        ...(braintrustMeta?.spanAttributes ?? {}),
      },
      event: {
        input: buildRootInput(event),
        metadata: {
          ...braintrustMeta?.metadata,
          model: modelId,
          ...(provider ? { provider } : {}),
          braintrust: {
            integration_name: "ai-sdk-telemetry",
            sdk_language: "typescript",
          },
        },
      },
    });

    this.callStates.set(event.callId, {
      operationId,
      rootSpan,
      toolSpans: new Map(),
      receivedFirstChunk: false,
      startTime: Date.now(),
      braintrustMeta,
    });
  };

  /**
   * Called when a step (single LLM invocation) begins.
   */
  onStepStart = (event: any): void => {
    const state = this.getState(event.callId);
    if (!state) return;

    const stepNumber: number = event.stepNumber ?? 0;
    const { model: modelId, provider } = extractModelInfo(event);

    state.stepSpan = withCurrent(state.rootSpan, () =>
      startSpan({
        name: `step-${stepNumber}`,
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: buildStepInput(event),
          metadata: {
            model: modelId,
            ...(provider ? { provider } : {}),
            stepNumber,
          },
        },
      }),
    );
  };

  /**
   * Called when a tool execution begins.
   */
  onToolCallStart = (event: any): void => {
    const state = this.getState(event.callId);
    if (!state) return;

    const parentSpan = state.stepSpan ?? state.rootSpan;
    const toolCall = event.toolCall;
    const toolName = toolCall?.toolName ?? "unknown-tool";
    const toolCallId = toolCall?.toolCallId;

    const toolSpan = withCurrent(parentSpan, () =>
      startSpan({
        name: toolName,
        spanAttributes: {
          type: SpanTypeAttribute.TOOL,
        },
        event: {
          input: toolCall?.input,
          metadata: {
            toolCallId,
          },
        },
      }),
    );

    if (toolCallId) {
      state.toolSpans.set(toolCallId, toolSpan);
    }
  };

  /**
   * Called when a tool execution completes.
   */
  onToolCallFinish = (event: any): void => {
    const state = this.getState(event.callId);
    if (!state) return;

    const toolCallId = event.toolCall?.toolCallId;
    if (!toolCallId) return;

    const toolSpan = state.toolSpans.get(toolCallId);
    if (!toolSpan) return;

    if (event.success) {
      toolSpan.log({
        output: event.output,
        metrics: {
          duration: event.durationMs / 1000,
        },
      });
    } else {
      toolSpan.log({
        error: serializeError(event.error),
        metrics: {
          duration: event.durationMs / 1000,
        },
      });
    }

    toolSpan.end();
    state.toolSpans.delete(toolCallId);
  };

  /**
   * Called for each streaming chunk (streamText only).
   */
  onChunk = (event: any): void => {
    const chunk = event.chunk;
    if (!chunk) return;

    // Handle stream timing markers
    if (
      chunk.type === "ai.stream.firstChunk" &&
      typeof chunk.callId === "string"
    ) {
      const state = this.getState(chunk.callId);
      if (state && !state.receivedFirstChunk) {
        state.receivedFirstChunk = true;
        const parentSpan = state.stepSpan ?? state.rootSpan;
        parentSpan.log({
          metrics: {
            time_to_first_token: (Date.now() - state.startTime) / 1000,
          },
        });
      }
    }
  };

  /**
   * Called when a step (single LLM invocation) completes.
   */
  onStepFinish = (event: any): void => {
    const state = this.getState(event.callId);
    if (!state) return;

    if (state.stepSpan) {
      state.stepSpan.log({
        output: buildStepOutput(event),
        metrics: usageToMetrics(event.usage),
      });
      state.stepSpan.end();
      state.stepSpan = undefined;
    }
  };

  /**
   * Called when the entire operation completes.
   */
  onFinish = (event: any): void => {
    const state = this.getState(event.callId);
    if (!state) return;

    // Close any remaining step span
    if (state.stepSpan) {
      state.stepSpan.end();
      state.stepSpan = undefined;
    }

    // Close any remaining tool spans
    for (const [, toolSpan] of state.toolSpans) {
      toolSpan.end();
    }
    state.toolSpans.clear();

    // Log output and metrics on the root span
    const totalUsage = event.totalUsage ?? event.usage;
    state.rootSpan.log({
      output: buildFinishOutput(event),
      metrics: usageToMetrics(totalUsage),
    });

    state.rootSpan.end();
    this.cleanup(event.callId);
  };

  /**
   * Called when an unrecoverable error occurs.
   */
  onError = (error: unknown): void => {
    // The error event may be the error itself or an object with callId + error
    const event = error as { callId?: string; error?: unknown };
    const callId = event?.callId;
    if (!callId) return;

    const state = this.getState(callId);
    if (!state) return;

    const actualError = event.error ?? error;

    // Close step span with error
    if (state.stepSpan) {
      state.stepSpan.log({ error: serializeError(actualError) });
      state.stepSpan.end();
      state.stepSpan = undefined;
    }

    // Close tool spans
    for (const [, toolSpan] of state.toolSpans) {
      toolSpan.log({ error: serializeError(actualError) });
      toolSpan.end();
    }
    state.toolSpans.clear();

    // Close root span with error
    state.rootSpan.log({ error: serializeError(actualError) });
    state.rootSpan.end();
    this.cleanup(callId);
  };

  /**
   * Runs tool execution within the Braintrust span context, enabling
   * nested traces when a tool's execute function calls generateText/streamText.
   */
  executeTool = async <T>(params: {
    callId: string;
    toolCallId: string;
    execute: () => PromiseLike<T>;
  }): Promise<T> => {
    const state = this.getState(params.callId);
    if (!state) return params.execute();

    const toolSpan = state.toolSpans.get(params.toolCallId);
    if (!toolSpan) return params.execute();

    return withCurrent(toolSpan, () => params.execute());
  };
}

/**
 * Extracts model ID and provider from an event object.
 */
function extractModelInfo(event: any): {
  model: string | undefined;
  provider: string | undefined;
} {
  return {
    model: event.modelId ?? undefined,
    provider: event.provider ?? undefined,
  };
}
