import { BasePlugin, toLoggedError } from "../core";
import { patchStreamIfNeeded } from "../core/stream-patcher";
import { debugLogger } from "../../debug-logger";
import { startSpan, withCurrent, type Span } from "../../logger";
import {
  INSTRUMENTATION_NAMES,
  withSpanInstrumentationName,
} from "../../span-origin";
import { SpanTypeAttribute } from "../../../util/index";
import {
  isAutoInstrumentationSuppressed,
  runWithAutoInstrumentationSuppressed,
} from "../auto-instrumentation-suppression";
import {
  lettaAgentSDKChannels,
  type LettaMessage,
} from "./letta-agent-sdk-channels";

type Turn = {
  span: Span;
  session: object;
  output: LettaMessage[];
  tools: Map<string, Span>;
  done: boolean;
  lastError?: string;
};

// Instrumentation failures must never change a session's result or lifecycle.
function safely<T>(callback: () => T): T | undefined {
  try {
    return callback();
  } catch (error) {
    debugLogger.error("Letta Agent SDK instrumentation failed:", error);
  }
}

function begin(
  name: string,
  input: unknown,
  metadata: Record<string, unknown>,
): Span {
  return startSpan(
    withSpanInstrumentationName(
      {
        name,
        spanAttributes: { type: SpanTypeAttribute.TASK },
        event: { input, metadata: { provider: "letta", ...metadata } },
      },
      INSTRUMENTATION_NAMES.LETTA_AGENT_SDK,
    ),
  );
}

function sessionMetadata(session: object): Record<string, unknown> {
  const { agentId, conversationId } = session as {
    agentId?: string;
    conversationId?: string;
  };
  return { "letta.agent_id": agentId, "letta.conversation_id": conversationId };
}

function messageInput(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  return input.map((part: unknown) => {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "image"
    ) {
      const source = "source" in part ? part.source : undefined;
      if (
        source &&
        typeof source === "object" &&
        "type" in source &&
        source.type === "base64"
      ) {
        return {
          type: "image",
          source: {
            type: "base64",
            ...("media_type" in source
              ? { media_type: source.media_type }
              : {}),
          },
        };
      }
    }
    return part;
  });
}

export class LettaAgentSDKPlugin extends BasePlugin {
  private turns = new WeakMap<object, Turn[]>();
  private active = new Set<Turn>();

  protected onEnable(): void {
    this.unsubscribers.push(
      lettaAgentSDKChannels.createAgent.intercept(
        async (target, self, args) => {
          if (isAutoInstrumentationSuppressed())
            return Reflect.apply(target, self, args);
          const options = args[0] ?? {};
          // Client/session options can contain API keys, environment variables,
          // callbacks, and transport credentials. Log only task configuration.
          const span = safely(() =>
            begin(
              "Letta createAgent",
              {
                systemPrompt: options.systemPrompt,
                memory: options.memory,
              },
              { model: options.model },
            ),
          );
          try {
            const result = await runWithAutoInstrumentationSuppressed(() =>
              Reflect.apply(target, self, args),
            );
            span?.log({ output: result });
            return result;
          } catch (error) {
            span?.log({
              error: error instanceof Error ? error : toLoggedError(error),
            });
            throw error;
          } finally {
            span?.end();
          }
        },
      ),
      lettaAgentSDKChannels.resumeSession.intercept((target, self, args) => {
        if (isAutoInstrumentationSuppressed())
          return Reflect.apply(target, self, args);
        const span = safely(() =>
          begin("Letta resumeSession", { id: args[0] }, {}),
        );
        try {
          const session = runWithAutoInstrumentationSuppressed(() =>
            Reflect.apply(target, self, args),
          );
          span?.log({ output: sessionMetadata(session) });
          return session;
        } catch (error) {
          span?.log({
            error: error instanceof Error ? error : toLoggedError(error),
          });
          throw error;
        } finally {
          span?.end();
        }
      }),
      lettaAgentSDKChannels.send.intercept(async (target, self, args) => {
        if (isAutoInstrumentationSuppressed())
          return Reflect.apply(target, self, args);
        const turn = safely(() => this.startTurn(self as object, args[0]));
        try {
          // send() only enqueues the input. Keep its span open until stream()
          // yields a terminal result, fails, is cancelled, or the session closes.
          return await runWithAutoInstrumentationSuppressed(() =>
            turn
              ? withCurrent(turn.span, () => Reflect.apply(target, self, args))
              : Reflect.apply(target, self, args),
          );
        } catch (error) {
          if (turn) this.finish(turn, error);
          throw error;
        }
      }),
      lettaAgentSDKChannels.stream.intercept((target, self, args) => {
        if (isAutoInstrumentationSuppressed())
          return Reflect.apply(target, self, args);
        let turn = this.turns.get(self as object)?.[0];
        let stream: AsyncGenerator<LettaMessage>;
        try {
          stream = runWithAutoInstrumentationSuppressed(() =>
            Reflect.apply(target, self, args),
          );
        } catch (error) {
          if (turn) this.finish(turn, error);
          throw error;
        }
        safely(() =>
          patchStreamIfNeeded<LettaMessage>(stream, {
            // Suppress internal structured-output retry sends, which belong to
            // this same turn, and preserve the caller's stream object/methods.
            aroundNext: (next) => {
              turn ??= this.turns.get(self as object)?.[0];
              return runWithAutoInstrumentationSuppressed(() =>
                turn ? withCurrent(turn.span, next) : next(),
              );
            },
            shouldCollect: (message) => {
              // Support a listener created before send().
              turn ??= this.turns.get(self as object)?.[0];
              const activeTurn = turn;
              if (activeTurn && !activeTurn.done)
                safely(() => this.message(activeTurn, message));
              // Process messages incrementally without retaining raw stream events.
              return false;
            },
            onComplete: () => {
              if (turn)
                this.finish(
                  turn,
                  "Letta stream ended before a terminal result",
                );
            },
            onCancel: () => {
              if (turn) this.finish(turn, undefined, true);
            },
            onError: (error) => {
              if (turn) this.finish(turn, error);
            },
          }),
        );
        return stream;
      }),
      lettaAgentSDKChannels.close.intercept((target, self, args) => {
        if (isAutoInstrumentationSuppressed())
          return Reflect.apply(target, self, args);
        try {
          return runWithAutoInstrumentationSuppressed(() =>
            Reflect.apply(target, self, args),
          );
        } finally {
          for (const turn of [...(this.turns.get(self as object) ?? [])])
            this.finish(turn, undefined, true);
        }
      }),
    );
  }

  protected onDisable(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    for (const turn of this.active) this.finish(turn, undefined, true);
  }

  private startTurn(session: object, input: unknown): Turn {
    const turn: Turn = {
      span: begin(
        "Letta Agent SDK",
        messageInput(input),
        sessionMetadata(session),
      ),
      session,
      output: [],
      tools: new Map(),
      done: false,
    };
    const queue = this.turns.get(session) ?? [];
    queue.push(turn);
    this.turns.set(session, queue);
    this.active.add(turn);
    return turn;
  }

  private message(turn: Turn, message: LettaMessage): void {
    switch (message.type) {
      case "init":
        turn.span.log({
          metadata: {
            model: message.model,
            "letta.agent_id": message.agentId,
            "letta.conversation_id": message.conversationId,
          },
        });
        break;
      case "assistant":
      case "reasoning":
        turn.output.push({ type: message.type, content: message.content });
        break;
      case "tool_call":
        if (message.toolCallId && !turn.tools.has(message.toolCallId)) {
          const tool = withCurrent(turn.span, () =>
            startSpan(
              withSpanInstrumentationName(
                {
                  name: "Letta tool",
                  spanAttributes: { type: SpanTypeAttribute.TOOL },
                  event: {
                    input: message.toolInput,
                    metadata: {
                      tool_name: message.toolName,
                      "letta.tool_call_id": message.toolCallId,
                    },
                  },
                },
                INSTRUMENTATION_NAMES.LETTA_AGENT_SDK,
              ),
            ),
          );
          turn.tools.set(message.toolCallId, tool);
        }
        break;
      case "tool_result": {
        const tool = message.toolCallId
          ? turn.tools.get(message.toolCallId)
          : undefined;
        if (tool) {
          tool.log({
            output: message.content,
            ...(message.isError ? { error: message.content } : {}),
          });
          tool.end();
          turn.tools.delete(message.toolCallId!);
        }
        break;
      }
      case "result":
        turn.span.log({
          output:
            message.structuredOutput !== undefined
              ? message.structuredOutput
              : (message.result ?? turn.output),
          metadata: {
            ...sessionMetadata(turn.session),
            "letta.success": message.success,
            "letta.stop_reason": message.stopReason,
            "letta.run_ids": message.runIds,
          },
          metrics: {
            ...(typeof message.durationMs === "number"
              ? { duration: message.durationMs / 1000 }
              : {}),
            ...(typeof message.totalCostUsd === "number"
              ? { estimated_cost: message.totalCostUsd }
              : {}),
          },
        });
        this.finish(
          turn,
          message.success === false
            ? (message.errorDetail ??
                turn.lastError ??
                message.error ??
                message.errorCode ??
                "Letta turn failed")
            : undefined,
          false,
          true,
        );
        break;
      case "error":
        turn.lastError =
          message.errorDetail ?? message.message ?? message.error;
        break;
    }
  }

  private finish(
    turn: Turn,
    error?: unknown,
    cancelled = false,
    hasResult = false,
  ): void {
    if (turn.done) return;
    turn.done = true;
    this.active.delete(turn);
    const queue = this.turns.get(turn.session);
    if (queue) {
      const index = queue.indexOf(turn);
      if (index !== -1) queue.splice(index, 1);
      if (!queue.length) this.turns.delete(turn.session);
    }
    for (const tool of turn.tools.values()) {
      tool.log({
        metadata: { "letta.incomplete": true },
        ...(error !== undefined
          ? { error: error instanceof Error ? error : toLoggedError(error) }
          : {}),
      });
      tool.end();
    }
    turn.tools.clear();
    turn.span.log({
      ...(!hasResult ? { output: turn.output } : {}),
      metadata: {
        ...sessionMetadata(turn.session),
        ...(cancelled ? { "letta.cancelled": true } : {}),
      },
      ...(error !== undefined
        ? { error: error instanceof Error ? error : toLoggedError(error) }
        : {}),
    });
    turn.span.end();
  }
}
