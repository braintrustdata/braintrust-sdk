import type { IsoChannelHandlers, IsoTracingChannel } from "../../isomorph";
import { isAsyncIterable } from "./stream-patcher";
import { isObject, mergeDicts } from "../../util";
import type {
  AnyAsyncChannel,
  AnySyncStreamChannel,
  AsyncEndOf,
  ChannelMessage,
  EndOf,
  ErrorOf,
  StartOf,
} from "./channel-definitions";
import type {
  ChannelSpanInfo,
  EventArguments,
  SpanInfoCarrier,
  StartEventWith,
} from "./types";

export type ChannelConfig = {
  name: string;
  type: string;
};

function hasChannelSpanInfo(
  value: unknown,
): value is SpanInfoCarrier & { span_info: ChannelSpanInfo } {
  return isObject(value) && isObject(value.span_info);
}

function getChannelSpanInfo<
  TArguments extends EventArguments,
  TExtra extends object,
>(
  event: StartEventWith<TArguments, TExtra> & SpanInfoCarrier,
): ChannelSpanInfo | undefined {
  if (isObject(event.span_info)) {
    return event.span_info;
  }

  const firstArg = event.arguments?.[0];
  if (hasChannelSpanInfo(firstArg)) {
    return firstArg.span_info;
  }

  return undefined;
}

export function buildStartSpanArgs<
  TArguments extends EventArguments,
  TExtra extends object,
>(
  config: ChannelConfig,
  event: StartEventWith<TArguments, TExtra> & SpanInfoCarrier,
): {
  name: string;
  spanAttributes: Record<string, unknown>;
  spanInfoMetadata: Record<string, unknown> | undefined;
} {
  const spanInfo = getChannelSpanInfo(event);
  const spanAttributes: Record<string, unknown> = {
    type: config.type,
  };

  if (isObject(spanInfo?.spanAttributes)) {
    mergeDicts(spanAttributes, spanInfo.spanAttributes);
  }

  return {
    name:
      typeof spanInfo?.name === "string" && spanInfo.name
        ? spanInfo.name
        : config.name,
    spanAttributes,
    spanInfoMetadata: isObject(spanInfo?.metadata)
      ? spanInfo.metadata
      : undefined,
  };
}

export function mergeInputMetadata(
  metadata: unknown,
  spanInfoMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!spanInfoMetadata) {
    return isObject(metadata)
      ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        (metadata as Record<string, unknown>)
      : undefined;
  }

  const mergedMetadata: Record<string, unknown> = {};
  mergeDicts(mergedMetadata, spanInfoMetadata);

  if (isObject(metadata)) {
    mergeDicts(mergedMetadata, metadata as Record<string, unknown>);
  }

  return mergedMetadata;
}

export function isStreamingResult<TResult>(
  result: TResult,
): result is Extract<TResult, AsyncIterable<unknown>> {
  return isAsyncIterable(result);
}

export type SyncStreamLike<TStreamEvent> = {
  on(event: "chunk", handler: (payload?: unknown) => void): unknown;
  on(
    event: "chatCompletion",
    handler: (payload?: { choices?: unknown }) => void,
  ): unknown;
  on(event: "event", handler: (payload: TStreamEvent) => void): unknown;
  on(event: "end", handler: () => void): unknown;
  on(event: "error", handler: (error: Error) => void): unknown;
};

export function isSyncStreamLike<TStreamEvent>(
  value: unknown,
): value is SyncStreamLike<TStreamEvent> {
  return isObject(value) && typeof value.on === "function";
}

export function hasChoices(value: unknown): value is { choices?: unknown } {
  return isObject(value) && "choices" in value;
}

const CHANNEL_HOOK_REF = Symbol("braintrust.channel_hook_ref");

export type ChannelHookArgs<TEvent> = {
  event: TEvent;
  fullChannelName: string;
  stateRef: symbol;
  hookRefSymbol: symbol;
};

type AsyncChannelHooks<TChannel extends AnyAsyncChannel> = {
  start?: (args: ChannelHookArgs<StartOf<TChannel>>) => void;
  end?: (args: ChannelHookArgs<EndOf<TChannel>>) => void;
  asyncStart?: (args: ChannelHookArgs<StartOf<TChannel>>) => void;
  asyncEnd?: (args: ChannelHookArgs<AsyncEndOf<TChannel>>) => void;
  error?: (args: ChannelHookArgs<ErrorOf<TChannel>>) => void;
};

type SyncStreamChannelHooks<TChannel extends AnySyncStreamChannel> = {
  start?: (args: ChannelHookArgs<StartOf<TChannel>>) => void;
  end?: (args: ChannelHookArgs<EndOf<TChannel>>) => void;
  error?: (args: ChannelHookArgs<ErrorOf<TChannel>>) => void;
};

function getStateRef(event: object): symbol {
  const eventWithRef = event as {
    [CHANNEL_HOOK_REF]?: symbol;
  };
  if (!eventWithRef[CHANNEL_HOOK_REF]) {
    eventWithRef[CHANNEL_HOOK_REF] = Symbol();
  }
  return eventWithRef[CHANNEL_HOOK_REF];
}

function wrapHook<TEvent>(
  fullChannelName: string,
  hook?: (args: ChannelHookArgs<TEvent>) => void,
): ((event: TEvent) => void) | undefined {
  if (!hook) {
    return undefined;
  }

  return (event: TEvent) => {
    hook({
      event,
      fullChannelName,
      stateRef: getStateRef(event as object),
      hookRefSymbol: CHANNEL_HOOK_REF,
    });
  };
}

export function subscribeToChannel<TChannel extends AnyAsyncChannel>(
  channel: TChannel,
  hooks: AsyncChannelHooks<TChannel>,
): () => void {
  const tracingChannel = channel.tracingChannel() as IsoTracingChannel<
    ChannelMessage<TChannel>
  >;
  const handlers: IsoChannelHandlers<ChannelMessage<TChannel>> = {
    start: wrapHook(channel.fullChannelName, hooks.start),
    end: wrapHook(channel.fullChannelName, hooks.end) as IsoChannelHandlers<
      ChannelMessage<TChannel>
    >["end"],
    asyncStart: wrapHook(channel.fullChannelName, hooks.asyncStart),
    asyncEnd: wrapHook(
      channel.fullChannelName,
      hooks.asyncEnd,
    ) as IsoChannelHandlers<ChannelMessage<TChannel>>["asyncEnd"],
    error: wrapHook(channel.fullChannelName, hooks.error) as IsoChannelHandlers<
      ChannelMessage<TChannel>
    >["error"],
  };
  tracingChannel.subscribe(handlers);

  return () => {
    tracingChannel.unsubscribe(handlers);
  };
}

export function subscribeToSyncStreamChannel<
  TChannel extends AnySyncStreamChannel,
>(channel: TChannel, hooks: SyncStreamChannelHooks<TChannel>): () => void {
  const tracingChannel = channel.tracingChannel() as IsoTracingChannel<
    ChannelMessage<TChannel>
  >;
  const handlers: IsoChannelHandlers<ChannelMessage<TChannel>> = {
    start: wrapHook(channel.fullChannelName, hooks.start),
    end: wrapHook(channel.fullChannelName, hooks.end) as IsoChannelHandlers<
      ChannelMessage<TChannel>
    >["end"],
    error: wrapHook(channel.fullChannelName, hooks.error) as IsoChannelHandlers<
      ChannelMessage<TChannel>
    >["error"],
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
