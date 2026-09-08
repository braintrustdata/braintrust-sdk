import { isObject, SpanTypeAttribute } from "../../../util";
import { debugLogger } from "../../debug-logger";
import { startSpan, withCurrent, type Span } from "../../logger";
import {
  INSTRUMENTATION_NAMES,
  withSpanInstrumentationName,
} from "../../span-origin";
import { getCurrentUnixTimestamp } from "../../util";
import type {
  LangGraphRunArgs,
  LangGraphStreamEvent,
} from "../../vendor-sdk-types/langgraph-sdk";
import {
  isAutoInstrumentationSuppressed,
  runWithAutoInstrumentationSuppressed,
} from "../auto-instrumentation-suppression";
import { BasePlugin } from "../core";
import { unsubscribeAll } from "../core/channel-tracing";
import { patchStreamIfNeeded } from "../core/stream-patcher";
import { langGraphSDKChannels } from "./langgraph-sdk-channels";

export class LangGraphSDKPlugin extends BasePlugin {
  protected onEnable(): void {
    this.unsubscribers.push(
      langGraphSDKChannels.wait.intercept((target, self, args) =>
        instrumentRun("wait", args, () => Reflect.apply(target, self, args)),
      ),
      langGraphSDKChannels.stream.intercept((target, self, args) =>
        instrumentRun("stream", args, () => Reflect.apply(target, self, args)),
      ),
    );
  }

  protected onDisable(): void {
    this.unsubscribers = unsubscribeAll(this.unsubscribers);
  }
}

function instrumentRun<T>(
  operation: "wait" | "stream",
  [threadId, assistantId, options]: LangGraphRunArgs,
  invoke: () => T,
): T {
  if (isAutoInstrumentationSuppressed()) return invoke();
  const start = getCurrentUnixTimestamp();
  let span: Span;
  try {
    // The remote server owns the agent loop. These client task spans do not
    // invent LLM/tool children or token counts that the server has not exposed.
    const metadata: Record<string, unknown> = {
      "langgraph.thread_id": threadId,
      "langgraph.assistant_id": assistantId,
    };
    for (const key of [
      "streamMode",
      "streamSubgraphs",
      "interruptBefore",
      "interruptAfter",
      "multitaskStrategy",
      "durability",
    ] as const) {
      if (options?.[key] !== undefined) metadata[key] = options[key];
    }
    span = startSpan(
      withSpanInstrumentationName(
        {
          name: `langgraph.runs.${operation}`,
          spanAttributes: { type: SpanTypeAttribute.TASK },
          event: {
            input:
              options?.command === undefined
                ? options?.input
                : { input: options.input, command: options.command },
            metadata,
          },
        },
        INSTRUMENTATION_NAMES.LANGGRAPH_SDK,
      ),
    );
  } catch (error) {
    debugLogger.error("Error starting LangGraph SDK span:", error);
    return invoke();
  }

  let ended = false;
  let output: unknown;
  let streamError: unknown;
  let firstToken: number | undefined;
  const updates: unknown[] = [];
  const usageByMessage = new Map<string, Record<string, number>>();
  const captureUsage = (id: string, usage: unknown) => {
    if (!isObject(usage)) return;
    const metrics: Record<string, number> = {};
    for (const [source, destination] of [
      ["input_tokens", "prompt_tokens"],
      ["output_tokens", "completion_tokens"],
      ["total_tokens", "tokens"],
    ] as const) {
      const value = usage[source];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        metrics[destination] = value;
    }
    if (
      metrics.tokens === undefined &&
      metrics.prompt_tokens !== undefined &&
      metrics.completion_tokens !== undefined
    )
      metrics.tokens = metrics.prompt_tokens + metrics.completion_tokens;
    usageByMessage.set(id, { ...usageByMessage.get(id), ...metrics });
  };
  const messages = new Map<string, Record<string, unknown>>();
  const finish = (error?: unknown) => {
    if (ended) return;
    ended = true;
    try {
      const metrics: Record<string, number> = {};
      for (const usage of usageByMessage.values()) {
        for (const [key, value] of Object.entries(usage))
          metrics[key] = (metrics[key] ?? 0) + value;
      }
      if (firstToken !== undefined)
        metrics.time_to_first_token = firstToken - start;
      span.log({
        output:
          output !== undefined
            ? output
            : messages.size
              ? { messages: [...messages.values()] }
              : updates.length
                ? updates
                : undefined,
        ...(error !== undefined || streamError !== undefined
          ? { error: error ?? streamError }
          : {}),
        metrics,
      });
    } catch (error) {
      debugLogger.error("Error logging LangGraph SDK span:", error);
    }
    try {
      span.end();
    } catch (error) {
      debugLogger.error("Error ending LangGraph SDK span:", error);
    }
  };
  const observeValues = (value: unknown, streaming: boolean) => {
    output = value;
    if (!isObject(value) || !Array.isArray(value.messages)) return;
    const inputMessages =
      isObject(options?.input) && Array.isArray(options.input.messages)
        ? options.input.messages
        : [];
    for (const message of value.messages) {
      if (
        !isObject(message) ||
        (message.type !== "ai" && message.role !== "assistant")
      )
        continue;
      // State snapshots may include messages from earlier turns.
      if (
        message.id !== undefined &&
        inputMessages.some(
          (input) => isObject(input) && input.id === message.id,
        )
      )
        continue;
      captureUsage(
        typeof message.id === "string" ? message.id : "message",
        message.usage_metadata,
      );
      if (
        streaming &&
        (typeof message.content === "string"
          ? message.content.length > 0
          : Array.isArray(message.content) &&
            message.content.some(
              (part) =>
                isObject(part) &&
                typeof part.text === "string" &&
                part.text.length > 0,
            ))
      )
        firstToken ??= getCurrentUnixTimestamp();
    }
  };
  const onChunk = ({ event, data }: LangGraphStreamEvent) => {
    if (ended) return;
    if (event === "metadata" && isObject(data)) {
      if (typeof data.run_id === "string")
        span.log({ metadata: { "langgraph.run_id": data.run_id } });
    } else if (event === "error") {
      streamError = isObject(data)
        ? new Error(`${data.error ?? "Error"}: ${data.message ?? "Run failed"}`)
        : data;
    } else if (event === "values") {
      observeValues(data, true);
    } else if (event === "updates") {
      updates.push(data);
    } else if (
      (event === "messages" ||
        event === "messages/partial" ||
        event === "messages/complete") &&
      Array.isArray(data)
    ) {
      const parts = event === "messages" ? [data[0]] : data;
      for (const part of parts) {
        if (!isObject(part)) continue;
        const id = typeof part.id === "string" ? part.id : "message";
        captureUsage(id, part.usage_metadata);
        const previous = messages.get(id);
        // `messages` carries deltas; the other modes carry message snapshots.
        messages.set(
          id,
          event === "messages" &&
            previous &&
            typeof part.content === "string" &&
            typeof previous.content === "string"
            ? { ...part, content: previous.content + part.content }
            : part,
        );
        if (typeof part.content === "string" && part.content.length > 0)
          firstToken ??= getCurrentUnixTimestamp();
      }
    }
  };

  let result: T;
  try {
    result = withCurrent(span, () =>
      runWithAutoInstrumentationSuppressed(invoke),
    );
  } catch (error) {
    finish(error);
    throw error;
  }
  if (operation === "stream") {
    try {
      patchStreamIfNeeded<LangGraphStreamEvent>(result, {
        shouldCollect: (chunk) => {
          try {
            onChunk(chunk);
          } catch (error) {
            debugLogger.error(
              "Error processing LangGraph stream event:",
              error,
            );
          }
          return false;
        },
        aroundNext: (next) =>
          withCurrent(span, () => runWithAutoInstrumentationSuppressed(next)),
        onComplete: () => finish(),
        onCancel: () => finish(),
        onError: (error) => finish(error),
      });
    } catch (error) {
      debugLogger.error("Error observing LangGraph stream:", error);
      finish();
    }
  } else {
    // Observe the original promise, retaining its identity and helper methods.
    void Promise.resolve(result).then(
      (value) => {
        try {
          observeValues(value, false);
          if (isObject(value) && isObject(value.__error__))
            streamError = new Error(
              `${value.__error__.error}: ${value.__error__.message}`,
            );
          finish();
        } catch (error) {
          finish(error);
        }
      },
      (error) => finish(error),
    );
  }
  return result;
}
