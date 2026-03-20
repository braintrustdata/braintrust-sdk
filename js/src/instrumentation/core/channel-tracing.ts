import type { IsoChannelHandlers, IsoTracingChannel } from "../../isomorph";
import { startSpan } from "../../logger";
import type { Span } from "../../logger";
import { getCurrentUnixTimestamp, isObject } from "../../util";
import type {
  AnyAsyncChannel,
  AnySyncStreamChannel,
  ArgsOf,
  AsyncEndOf,
  ChannelMessage,
  ChunkOf,
  EndOf,
  ErrorOf,
  ResultOf,
  StartOf,
} from "./channel-definitions";
import { isAsyncIterable, patchStreamIfNeeded } from "./stream-patcher";
import {
  buildStartSpanArgs,
  mergeInputMetadata,
  type ChannelConfig,
} from "./channel-tracing-utils";

type SpanState = {
  span: Span;
  startTime: number;
};

export type AsyncChannelSpanConfig<TChannel extends AnyAsyncChannel> =
  ChannelConfig & {
    extractInput: (
      args: [...ArgsOf<TChannel>],
      event: StartOf<TChannel>,
      span: Span,
    ) => {
      input: unknown;
      metadata: unknown;
    };
    extractOutput: (
      result: ResultOf<TChannel>,
      endEvent?: AsyncEndOf<TChannel>,
    ) => unknown;
    extractMetadata?: (
      result: ResultOf<TChannel>,
      endEvent?: AsyncEndOf<TChannel>,
    ) => unknown;
    extractMetrics: (
      result: ResultOf<TChannel>,
      startTime?: number,
      endEvent?: AsyncEndOf<TChannel>,
    ) => Record<string, number>;
  };

type StreamingResult<TChannel extends AnyAsyncChannel> = Exclude<
  ResultOf<TChannel>,
  AsyncIterable<unknown>
>;

export type StreamingChannelSpanConfig<TChannel extends AnyAsyncChannel> =
  ChannelConfig & {
    extractInput: (
      args: [...ArgsOf<TChannel>],
      event: StartOf<TChannel>,
      span: Span,
    ) => {
      input: unknown;
      metadata: unknown;
    };
    extractOutput: (
      result: StreamingResult<TChannel>,
      endEvent?: AsyncEndOf<TChannel>,
    ) => unknown;
    extractMetadata?: (
      result: StreamingResult<TChannel>,
      endEvent?: AsyncEndOf<TChannel>,
    ) => unknown;
    extractMetrics: (
      result: StreamingResult<TChannel>,
      startTime?: number,
      endEvent?: AsyncEndOf<TChannel>,
    ) => Record<string, number>;
    aggregateChunks?: (
      chunks: ChunkOf<TChannel>[],
      result?: ResultOf<TChannel>,
      endEvent?: AsyncEndOf<TChannel>,
      startTime?: number,
    ) => {
      output: unknown;
      metrics: Record<string, number>;
      metadata?: Record<string, unknown>;
    };
    patchResult?: (args: {
      channelName: string;
      endEvent: AsyncEndOf<TChannel>;
      result: StreamingResult<TChannel>;
      span: Span;
      startTime: number;
    }) => boolean;
  };

export type SyncStreamChannelSpanConfig<TChannel extends AnySyncStreamChannel> =
  ChannelConfig & {
    extractInput: (
      args: [...ArgsOf<TChannel>],
      event: StartOf<TChannel>,
      span: Span,
    ) => {
      input: unknown;
      metadata: unknown;
    };
    extractFromEvent?: (event: ChunkOf<TChannel>) => {
      output?: unknown;
      metrics?: Record<string, number>;
      metadata?: Record<string, unknown>;
    };
    patchResult?: (args: {
      channelName: string;
      endEvent: EndOf<TChannel>;
      result: ResultOf<TChannel>;
      span: Span;
      startTime: number;
    }) => boolean;
  };

export type SyncResultChannelSpanConfig<
  TChannel extends AnyAsyncChannel | AnySyncStreamChannel,
> = ChannelConfig & {
  extractInput: (
    args: [...ArgsOf<TChannel>],
    event: StartOf<TChannel>,
    span: Span,
  ) => {
    input: unknown;
    metadata: unknown;
  };
  extractOutput?: (
    result: ResultOf<TChannel>,
    endEvent?: TChannel extends AnyAsyncChannel
      ? EndOf<TChannel> | AsyncEndOf<TChannel>
      : EndOf<TChannel>,
  ) => unknown;
  extractMetadata?: (
    result: ResultOf<TChannel>,
    endEvent?: TChannel extends AnyAsyncChannel
      ? EndOf<TChannel> | AsyncEndOf<TChannel>
      : EndOf<TChannel>,
  ) => unknown;
  extractMetrics?: (
    result: ResultOf<TChannel>,
    startTime?: number,
    endEvent?: TChannel extends AnyAsyncChannel
      ? EndOf<TChannel> | AsyncEndOf<TChannel>
      : EndOf<TChannel>,
  ) => Record<string, number>;
  aggregateChunks?: TChannel extends AnyAsyncChannel
    ? (
        chunks: ChunkOf<TChannel>[],
        result?: ResultOf<TChannel>,
        endEvent?: EndOf<TChannel> | AsyncEndOf<TChannel>,
        startTime?: number,
      ) => {
        output: unknown;
        metrics: Record<string, number>;
        metadata?: Record<string, unknown>;
      }
    : never;
  patchResult?: (args: {
    channelName: string;
    endEvent: TChannel extends AnyAsyncChannel
      ? EndOf<TChannel> | AsyncEndOf<TChannel>
      : EndOf<TChannel>;
    result: ResultOf<TChannel>;
    span: Span;
    startTime: number;
  }) => boolean;
};

type SyncStreamLike<TStreamEvent> = {
  on(event: "chunk", handler: (payload?: unknown) => void): unknown;
  on(
    event: "chatCompletion",
    handler: (payload?: { choices?: unknown }) => void,
  ): unknown;
  on(event: "event", handler: (payload: TStreamEvent) => void): unknown;
  on(event: "end", handler: () => void): unknown;
  on(event: "error", handler: (error: Error) => void): unknown;
};

function isSyncStreamLike<TStreamEvent>(
  value: unknown,
): value is SyncStreamLike<TStreamEvent> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { on?: unknown }).on === "function"
  );
}

function hasChoices(value: unknown): value is { choices?: unknown } {
  return !!value && typeof value === "object" && "choices" in value;
}

function normalizeMetadata(
  metadata: unknown,
): Record<string, unknown> | undefined {
  return isObject(metadata) ? (metadata as Record<string, unknown>) : undefined;
}

function startSpanForEvent<
  TChannel extends AnyAsyncChannel | AnySyncStreamChannel,
>(
  config: ChannelConfig & {
    extractInput: (
      args: [...ArgsOf<TChannel>],
      event: StartOf<TChannel>,
      span: Span,
    ) => {
      input: unknown;
      metadata: unknown;
    };
  },
  event: StartOf<TChannel>,
  channelName: string,
): SpanState {
  const { name, spanAttributes, spanInfoMetadata } = buildStartSpanArgs(
    config,
    event,
  );
  const span = startSpan({
    name,
    spanAttributes,
  });
  const startTime = getCurrentUnixTimestamp();

  try {
    const { input, metadata } = config.extractInput(
      event.arguments,
      event as StartOf<TChannel>,
      span,
    );
    span.log({
      input,
      metadata: mergeInputMetadata(metadata, spanInfoMetadata),
    });
  } catch (error) {
    console.error(`Error extracting input for ${channelName}:`, error);
  }

  return { span, startTime };
}

function logErrorAndEnd<
  TChannel extends AnyAsyncChannel | AnySyncStreamChannel,
>(states: WeakMap<object, SpanState>, event: ErrorOf<TChannel>): void {
  const spanData = states.get(event as object);
  if (!spanData) {
    return;
  }

  spanData.span.log({
    error: event.error.message,
  });
  spanData.span.end();
  states.delete(event as object);
}

function logResultAndEnd<
  TChannel extends AnyAsyncChannel | AnySyncStreamChannel,
>(
  states: WeakMap<object, SpanState>,
  config: SyncResultChannelSpanConfig<TChannel>,
  channelName: string,
  event: TChannel extends AnyAsyncChannel
    ? EndOf<TChannel> | AsyncEndOf<TChannel>
    : EndOf<TChannel>,
): void {
  const spanData = states.get(event as object);
  if (!spanData) {
    return;
  }

  const { span, startTime } = spanData;
  const result = event.result as ResultOf<TChannel>;

  if (
    config.patchResult?.({
      channelName,
      endEvent: event,
      result,
      span,
      startTime,
    })
  ) {
    states.delete(event as object);
    return;
  }

  if (config.aggregateChunks && isAsyncIterable(result)) {
    let firstChunkTime: number | undefined;

    patchStreamIfNeeded(result, {
      onChunk: () => {
        if (firstChunkTime === undefined) {
          firstChunkTime = getCurrentUnixTimestamp();
        }
      },
      onComplete: (chunks) => {
        try {
          const aggregated = config.aggregateChunks?.(
            chunks as ChunkOf<Extract<TChannel, AnyAsyncChannel>>[],
            result,
            event,
            startTime,
          );

          if (!aggregated) {
            span.end();
            return;
          }

          if (
            aggregated.metrics.time_to_first_token === undefined &&
            firstChunkTime !== undefined
          ) {
            aggregated.metrics.time_to_first_token = firstChunkTime - startTime;
          } else if (
            aggregated.metrics.time_to_first_token === undefined &&
            chunks.length > 0
          ) {
            aggregated.metrics.time_to_first_token =
              getCurrentUnixTimestamp() - startTime;
          }

          span.log({
            output: aggregated.output,
            ...(aggregated.metadata !== undefined
              ? { metadata: aggregated.metadata }
              : {}),
            metrics: aggregated.metrics,
          });
        } catch (error) {
          console.error(`Error extracting output for ${channelName}:`, error);
        } finally {
          span.end();
          states.delete(event as object);
        }
      },
      onError: (error: Error) => {
        span.log({
          error: error.message,
        });
        span.end();
        states.delete(event as object);
      },
    });
    return;
  }

  try {
    const output = config.extractOutput?.(result, event);
    const metrics = config.extractMetrics?.(result, startTime, event);
    const metadata = config.extractMetadata?.(result, event);

    if (
      output !== undefined ||
      metrics !== undefined ||
      normalizeMetadata(metadata) !== undefined
    ) {
      span.log({
        ...(output !== undefined ? { output } : {}),
        ...(normalizeMetadata(metadata) !== undefined
          ? { metadata: normalizeMetadata(metadata) }
          : {}),
        ...(metrics !== undefined ? { metrics } : {}),
      });
    }
  } catch (error) {
    console.error(`Error extracting output for ${channelName}:`, error);
  } finally {
    span.end();
    states.delete(event as object);
  }
}

export function traceAsyncChannel<TChannel extends AnyAsyncChannel>(
  channel: TChannel,
  config: AsyncChannelSpanConfig<TChannel>,
): () => void {
  const tracingChannel = channel.tracingChannel() as IsoTracingChannel<
    ChannelMessage<TChannel>
  >;
  const states = new WeakMap<object, SpanState>();
  const channelName = channel.channelName;

  const handlers: IsoChannelHandlers<ChannelMessage<TChannel>> = {
    start: (event) => {
      states.set(
        event as object,
        startSpanForEvent<TChannel>(
          config,
          event as StartOf<TChannel>,
          channelName,
        ),
      );
    },
    asyncEnd: (event) => {
      const spanData = states.get(event as object);
      if (!spanData) {
        return;
      }

      const asyncEndEvent = event as AsyncEndOf<TChannel>;
      const { span, startTime } = spanData;

      try {
        const output = config.extractOutput(
          asyncEndEvent.result,
          asyncEndEvent,
        );
        const metrics = config.extractMetrics(
          asyncEndEvent.result,
          startTime,
          asyncEndEvent,
        );
        const metadata = config.extractMetadata?.(
          asyncEndEvent.result,
          asyncEndEvent,
        );

        span.log({
          output,
          ...(normalizeMetadata(metadata) !== undefined
            ? { metadata: normalizeMetadata(metadata) }
            : {}),
          metrics,
        });
      } catch (error) {
        console.error(`Error extracting output for ${channelName}:`, error);
      } finally {
        span.end();
        states.delete(event as object);
      }
    },
    error: (event) => {
      logErrorAndEnd(states, event as ErrorOf<TChannel>);
    },
  };

  tracingChannel.subscribe(handlers);

  return () => {
    tracingChannel.unsubscribe(handlers);
  };
}

export function traceStreamingChannel<TChannel extends AnyAsyncChannel>(
  channel: TChannel,
  config: StreamingChannelSpanConfig<TChannel>,
): () => void {
  const tracingChannel = channel.tracingChannel() as IsoTracingChannel<
    ChannelMessage<TChannel>
  >;
  const states = new WeakMap<object, SpanState>();
  const channelName = channel.channelName;

  const handlers: IsoChannelHandlers<ChannelMessage<TChannel>> = {
    start: (event) => {
      states.set(
        event as object,
        startSpanForEvent<TChannel>(
          config,
          event as StartOf<TChannel>,
          channelName,
        ),
      );
    },
    asyncEnd: (event) => {
      const spanData = states.get(event as object);
      if (!spanData) {
        return;
      }

      const asyncEndEvent = event as AsyncEndOf<TChannel>;
      const { span, startTime } = spanData;

      if (isAsyncIterable(asyncEndEvent.result)) {
        let firstChunkTime: number | undefined;

        patchStreamIfNeeded(asyncEndEvent.result, {
          onChunk: () => {
            if (firstChunkTime === undefined) {
              firstChunkTime = getCurrentUnixTimestamp();
            }
          },
          onComplete: (chunks: ChunkOf<TChannel>[]) => {
            try {
              let output: unknown;
              let metrics: Record<string, number>;
              let metadata: Record<string, unknown> | undefined;

              if (config.aggregateChunks) {
                const aggregated = config.aggregateChunks(
                  chunks,
                  asyncEndEvent.result,
                  asyncEndEvent,
                  startTime,
                );
                output = aggregated.output;
                metrics = aggregated.metrics;
                metadata = aggregated.metadata;
              } else {
                output = config.extractOutput(
                  chunks as unknown as StreamingResult<TChannel>,
                  asyncEndEvent,
                );
                metrics = config.extractMetrics(
                  chunks as unknown as StreamingResult<TChannel>,
                  startTime,
                  asyncEndEvent,
                );
              }

              if (
                metrics.time_to_first_token === undefined &&
                firstChunkTime !== undefined
              ) {
                metrics.time_to_first_token = firstChunkTime - startTime;
              } else if (
                metrics.time_to_first_token === undefined &&
                chunks.length > 0
              ) {
                metrics.time_to_first_token =
                  getCurrentUnixTimestamp() - startTime;
              }

              span.log({
                output,
                ...(metadata !== undefined ? { metadata } : {}),
                metrics,
              });
            } catch (error) {
              console.error(
                `Error extracting output for ${channelName}:`,
                error,
              );
            } finally {
              span.end();
              states.delete(event as object);
            }
          },
          onError: (error: Error) => {
            span.log({
              error: error.message,
            });
            span.end();
            states.delete(event as object);
          },
        });
        return;
      }

      if (
        config.patchResult?.({
          channelName,
          endEvent: asyncEndEvent,
          result: asyncEndEvent.result as StreamingResult<TChannel>,
          span,
          startTime,
        })
      ) {
        states.delete(event as object);
        return;
      }

      try {
        const output = config.extractOutput(
          asyncEndEvent.result as StreamingResult<TChannel>,
          asyncEndEvent,
        );
        const metrics = config.extractMetrics(
          asyncEndEvent.result as StreamingResult<TChannel>,
          startTime,
          asyncEndEvent,
        );
        const metadata = config.extractMetadata?.(
          asyncEndEvent.result as StreamingResult<TChannel>,
          asyncEndEvent,
        );

        span.log({
          output,
          ...(normalizeMetadata(metadata) !== undefined
            ? { metadata: normalizeMetadata(metadata) }
            : {}),
          metrics,
        });
      } catch (error) {
        console.error(`Error extracting output for ${channelName}:`, error);
      } finally {
        span.end();
        states.delete(event as object);
      }
    },
    error: (event) => {
      logErrorAndEnd(states, event as ErrorOf<TChannel>);
    },
  };

  tracingChannel.subscribe(handlers);

  return () => {
    tracingChannel.unsubscribe(handlers);
  };
}

export function traceSyncResultChannel<
  TChannel extends AnyAsyncChannel | AnySyncStreamChannel,
>(
  channel: TChannel,
  config: SyncResultChannelSpanConfig<TChannel>,
): () => void {
  const tracingChannel = channel.tracingChannel() as IsoTracingChannel<
    ChannelMessage<TChannel>
  >;
  const states = new WeakMap<object, SpanState>();
  const channelName = channel.channelName;

  const handlers: IsoChannelHandlers<ChannelMessage<TChannel>> = {
    start: (event) => {
      states.set(
        event as object,
        startSpanForEvent<TChannel>(
          config,
          event as StartOf<TChannel>,
          channelName,
        ),
      );
    },
    end: (event) => {
      const spanData = states.get(event as object);
      if (!spanData) {
        return;
      }

      const { span, startTime } = spanData;
      const endEvent = event as EndOf<TChannel>;

      if (
        config.patchResult?.({
          channelName,
          endEvent,
          result: endEvent.result,
          span,
          startTime,
        })
      ) {
        states.delete(event as object);
        return;
      }

      if (channel.kind === "async") {
        return;
      }

      logResultAndEnd(states, config, channelName, endEvent);
    },
    asyncEnd: (event) => {
      logResultAndEnd(
        states,
        config,
        channelName,
        event as AsyncEndOf<TChannel>,
      );
    },
    error: (event) => {
      logErrorAndEnd(states, event as ErrorOf<TChannel>);
    },
  };

  tracingChannel.subscribe(handlers);

  return () => {
    tracingChannel.unsubscribe(handlers);
  };
}

export function traceSyncStreamChannel<TChannel extends AnySyncStreamChannel>(
  channel: TChannel,
  config: SyncStreamChannelSpanConfig<TChannel>,
): () => void {
  const tracingChannel = channel.tracingChannel() as IsoTracingChannel<
    ChannelMessage<TChannel>
  >;
  const states = new WeakMap<object, SpanState>();
  const channelName = channel.channelName;

  const handlers: IsoChannelHandlers<ChannelMessage<TChannel>> = {
    start: (event) => {
      states.set(
        event as object,
        startSpanForEvent<TChannel>(
          config,
          event as StartOf<TChannel>,
          channelName,
        ),
      );
    },
    end: (event) => {
      const spanData = states.get(event as object);
      if (!spanData) {
        return;
      }

      const { span, startTime } = spanData;
      const endEvent = event as EndOf<TChannel>;

      if (
        config.patchResult?.({
          channelName,
          endEvent,
          result: endEvent.result,
          span,
          startTime,
        })
      ) {
        return;
      }

      const stream = endEvent.result;

      if (!isSyncStreamLike<ChunkOf<TChannel>>(stream)) {
        span.end();
        states.delete(event as object);
        return;
      }

      let first = true;

      stream.on("chunk", () => {
        if (first) {
          span.log({
            metrics: {
              time_to_first_token: getCurrentUnixTimestamp() - startTime,
            },
          });
          first = false;
        }
      });

      stream.on("chatCompletion", (completion) => {
        try {
          if (hasChoices(completion)) {
            span.log({
              output: completion.choices,
            });
          }
        } catch (error) {
          console.error(
            `Error extracting chatCompletion for ${channelName}:`,
            error,
          );
        }
      });

      stream.on("event", (streamEvent) => {
        if (!config.extractFromEvent) {
          return;
        }

        try {
          if (first) {
            span.log({
              metrics: {
                time_to_first_token: getCurrentUnixTimestamp() - startTime,
              },
            });
            first = false;
          }

          const extracted = config.extractFromEvent(streamEvent);
          if (extracted && Object.keys(extracted).length > 0) {
            span.log(extracted);
          }
        } catch (error) {
          console.error(`Error extracting event for ${channelName}:`, error);
        }
      });

      stream.on("end", () => {
        span.end();
        states.delete(event as object);
      });

      stream.on("error", (error: Error) => {
        span.log({
          error: error.message,
        });
        span.end();
        states.delete(event as object);
      });
    },
    error: (event) => {
      logErrorAndEnd(states, event as ErrorOf<TChannel>);
    },
  };

  tracingChannel.subscribe(handlers);

  return () => {
    tracingChannel.unsubscribe(handlers);
  };
}

export function unsubscribeAll(
  unsubscribers: Array<() => void>,
): Array<() => void> {
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }

  return [];
}
