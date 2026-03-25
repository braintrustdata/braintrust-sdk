import { BasePlugin } from "../core";
import { unsubscribeAll } from "../core/channel-tracing";
import type {
  ChannelMessage,
  ErrorOf,
  StartOf,
} from "../core/channel-definitions";
import type {
  IsoAsyncLocalStorage,
  IsoChannelHandlers,
  IsoTracingChannel,
} from "../../isomorph";
import {
  _internalGetGlobalState,
  BRAINTRUST_CURRENT_SPAN_STORE,
  startSpan,
  type StartSpanArgs,
  type Span,
} from "../../logger";
import { SpanTypeAttribute } from "../../../util/index";
import { getCurrentUnixTimestamp } from "../../util";
import { googleGenAIChannels } from "./google-genai-channels";
import {
  aggregateGenerateContentChunks,
  cleanMetrics,
  extractGenerateContentMetrics,
  extractMetadata,
  serializeInput,
} from "./google-genai-shared";
import type { GoogleGenAIGenerateContentResponse } from "../../vendor-sdk-types/google-genai";

type GenerateContentChannel = typeof googleGenAIChannels.generateContent;
type GenerateContentStreamChannel =
  typeof googleGenAIChannels.generateContentStream;
type GenerateContentStreamEvent =
  ChannelMessage<GenerateContentStreamChannel> & {
    googleGenAIInput?: Record<string, unknown>;
    googleGenAIMetadata?: Record<string, unknown>;
    googleGenAIStartTime?: number;
  };

type SpanState = {
  span: Span;
  startTime: number;
};

const GOOGLE_GENAI_INTERNAL_CONTEXT = {
  caller_filename: "<node-internal>",
  caller_functionname: "<node-internal>",
  caller_lineno: 0,
};

function createWrapperParityEvent(args: {
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): StartSpanArgs["event"] {
  return {
    context: GOOGLE_GENAI_INTERNAL_CONTEXT,
    input: args.input,
    metadata: args.metadata,
  } as StartSpanArgs["event"];
}

/**
 * Auto-instrumentation plugin for the Google GenAI SDK.
 *
 * This plugin subscribes to orchestrion channels for Google GenAI SDK methods
 * and creates Braintrust spans to track:
 * - models.generateContent (non-streaming)
 * - models.generateContentStream (streaming)
 *
 * The plugin handles:
 * - Google-specific token metrics (promptTokenCount, candidatesTokenCount, cachedContentTokenCount)
 * - Processing streaming responses
 * - Converting inline data (images) to Attachment objects
 * - Tool calls (functionCall, functionResponse) and executable code results
 */
export class GoogleGenAIPlugin extends BasePlugin {
  protected onEnable(): void {
    this.subscribeToGoogleGenAIChannels();
  }

  protected onDisable(): void {
    this.unsubscribers = unsubscribeAll(this.unsubscribers);
  }

  private subscribeToGoogleGenAIChannels(): void {
    this.subscribeToGenerateContentChannel();
    this.subscribeToGenerateContentStreamChannel();
  }

  private subscribeToGenerateContentChannel(): void {
    const tracingChannel =
      googleGenAIChannels.generateContent.tracingChannel() as IsoTracingChannel<
        ChannelMessage<GenerateContentChannel>
      >;
    const states = new WeakMap<object, SpanState>();
    const unbindCurrentSpanStore = bindCurrentSpanStoreToStart(
      tracingChannel,
      states,
      (event) => {
        const params = event.arguments[0];
        const input = serializeInput(params);
        const metadata = extractMetadata(params);
        const span = startSpan({
          name: "generate_content",
          spanAttributes: {
            type: SpanTypeAttribute.LLM,
          },
          event: createWrapperParityEvent({ input, metadata }),
        });

        return {
          span,
          startTime: getCurrentUnixTimestamp(),
        };
      },
    );

    const handlers: IsoChannelHandlers<ChannelMessage<GenerateContentChannel>> =
      {
        start: (event) => {
          ensureSpanState(states, event, () => {
            const params = event.arguments[0];
            const input = serializeInput(params);
            const metadata = extractMetadata(params);
            const span = startSpan({
              name: "generate_content",
              spanAttributes: {
                type: SpanTypeAttribute.LLM,
              },
              event: createWrapperParityEvent({ input, metadata }),
            });

            return {
              span,
              startTime: getCurrentUnixTimestamp(),
            };
          });
        },
        asyncEnd: (event) => {
          const spanState = states.get(event as object);
          if (!spanState) {
            return;
          }

          try {
            spanState.span.log({
              metrics: cleanMetrics(
                extractGenerateContentMetrics(
                  event.result,
                  spanState.startTime,
                ),
              ),
              output: event.result,
            });
          } finally {
            spanState.span.end();
            states.delete(event as object);
          }
        },
        error: (event) => {
          logErrorAndEndSpan(states, event as ErrorOf<GenerateContentChannel>);
        },
      };

    tracingChannel.subscribe(handlers);
    this.unsubscribers.push(() => {
      unbindCurrentSpanStore?.();
      tracingChannel.unsubscribe(handlers);
    });
  }

  private subscribeToGenerateContentStreamChannel(): void {
    const tracingChannel =
      googleGenAIChannels.generateContentStream.tracingChannel() as IsoTracingChannel<
        ChannelMessage<GenerateContentStreamChannel>
      >;

    const handlers: IsoChannelHandlers<
      ChannelMessage<GenerateContentStreamChannel>
    > = {
      start: (event) => {
        const streamEvent = event as GenerateContentStreamEvent;
        const params = event.arguments[0];
        streamEvent.googleGenAIInput = serializeInput(params);
        streamEvent.googleGenAIMetadata = extractMetadata(params);
        streamEvent.googleGenAIStartTime = getCurrentUnixTimestamp();
      },
      asyncEnd: (event) => {
        const streamEvent = event as GenerateContentStreamEvent;
        patchGoogleGenAIStreamingResult({
          input: streamEvent.googleGenAIInput,
          metadata: streamEvent.googleGenAIMetadata,
          startTime: streamEvent.googleGenAIStartTime,
          result: streamEvent.result,
        });
      },
      error: () => {},
    };

    tracingChannel.subscribe(handlers);
    this.unsubscribers.push(() => {
      tracingChannel.unsubscribe(handlers);
    });
  }
}

function ensureSpanState<TEvent extends object>(
  states: WeakMap<object, SpanState>,
  event: TEvent,
  create: () => SpanState,
): SpanState {
  const existing = states.get(event);
  if (existing) {
    return existing;
  }

  const created = create();
  states.set(event, created);
  return created;
}

function bindCurrentSpanStoreToStart<TChannel extends GenerateContentChannel>(
  tracingChannel: IsoTracingChannel<ChannelMessage<TChannel>>,
  states: WeakMap<object, SpanState>,
  create: (event: StartOf<TChannel>) => SpanState,
): (() => void) | undefined {
  const state = _internalGetGlobalState();
  const startChannel = tracingChannel.start as
    | ({
        bindStore?: (
          store: IsoAsyncLocalStorage<Span>,
          callback: (event: ChannelMessage<TChannel>) => Span,
        ) => void;
        unbindStore?: (store: IsoAsyncLocalStorage<Span>) => void;
      } & object)
    | undefined;
  const currentSpanStore = state?.contextManager
    ? (
        state.contextManager as {
          [BRAINTRUST_CURRENT_SPAN_STORE]?: IsoAsyncLocalStorage<Span>;
        }
      )[BRAINTRUST_CURRENT_SPAN_STORE]
    : undefined;

  if (!startChannel?.bindStore || !currentSpanStore) {
    return undefined;
  }

  startChannel.bindStore(
    currentSpanStore,
    (event) =>
      ensureSpanState(states, event as object, () =>
        create(event as StartOf<TChannel>),
      ).span,
  );

  return () => {
    startChannel.unbindStore?.(currentSpanStore);
  };
}

function logErrorAndEndSpan<TChannel extends GenerateContentChannel>(
  states: WeakMap<object, SpanState>,
  event: ErrorOf<TChannel>,
): void {
  const spanState = states.get(event as object);
  if (!spanState) {
    return;
  }

  spanState.span.log({
    error: event.error.message,
  });
  spanState.span.end();
  states.delete(event as object);
}

function patchGoogleGenAIStreamingResult(args: {
  input: Record<string, unknown> | undefined;
  metadata: Record<string, unknown> | undefined;
  startTime: number | undefined;
  result: unknown;
}): boolean {
  const { input, metadata, result, startTime } = args;

  if (
    !input ||
    !metadata ||
    !result ||
    typeof result !== "object" ||
    typeof (result as AsyncIterator<GoogleGenAIGenerateContentResponse>)
      .next !== "function"
  ) {
    return false;
  }

  const chunks: GoogleGenAIGenerateContentResponse[] = [];
  let firstTokenTime: number | null = null;
  let finalized = false;
  let span: Span | null = null;
  const requestStartTime = startTime ?? getCurrentUnixTimestamp();

  const ensureSpan = () => {
    if (!span) {
      span = startSpan({
        name: "generate_content_stream",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input,
          metadata,
        },
      });
    }

    return span;
  };

  const finalize = (options: {
    error?: unknown;
    result?: {
      aggregated: Record<string, unknown>;
      metrics: Record<string, number>;
    };
  }) => {
    if (finalized || !span) {
      return;
    }

    finalized = true;

    if (options.result) {
      const { end, ...metricsWithoutEnd } = options.result.metrics;
      span.log({
        metrics: cleanMetrics(metricsWithoutEnd),
        output: options.result.aggregated,
      });
      span.end(typeof end === "number" ? { endTime: end } : undefined);
      return;
    }

    if (options.error !== undefined) {
      span.log({
        error:
          options.error instanceof Error
            ? options.error.message
            : String(options.error),
      });
    }

    span.end();
  };

  const patchIterator = (
    iterator: AsyncIterator<GoogleGenAIGenerateContentResponse>,
  ): AsyncIterator<GoogleGenAIGenerateContentResponse> => {
    if (
      typeof iterator !== "object" ||
      iterator === null ||
      "__braintrustGoogleGenAIPatched" in (iterator as object)
    ) {
      return iterator;
    }

    const iteratorRecord =
      iterator as AsyncIterator<GoogleGenAIGenerateContentResponse> &
        Record<string | symbol, unknown>;
    const originalNext =
      typeof iteratorRecord.next === "function"
        ? (
            iteratorRecord.next as (
              ...args: [] | [undefined]
            ) => Promise<IteratorResult<GoogleGenAIGenerateContentResponse>>
          ).bind(iterator)
        : undefined;
    const originalReturn =
      typeof iteratorRecord.return === "function"
        ? (
            iteratorRecord.return as (
              ...args: [] | [unknown]
            ) => Promise<IteratorResult<GoogleGenAIGenerateContentResponse>>
          ).bind(iterator)
        : undefined;
    const originalThrow =
      typeof iteratorRecord.throw === "function"
        ? (
            iteratorRecord.throw as (
              ...args: [] | [unknown]
            ) => Promise<IteratorResult<GoogleGenAIGenerateContentResponse>>
          ).bind(iterator)
        : undefined;
    const asyncIteratorMethod = iteratorRecord[Symbol.asyncIterator];
    const originalAsyncIterator =
      typeof asyncIteratorMethod === "function"
        ? (
            asyncIteratorMethod as () => AsyncIterator<GoogleGenAIGenerateContentResponse>
          ).bind(iterator)
        : undefined;

    Object.defineProperty(iteratorRecord, "__braintrustGoogleGenAIPatched", {
      configurable: true,
      enumerable: false,
      value: true,
      writable: false,
    });

    if (originalNext) {
      iteratorRecord.next = async (...nextArgs: [] | [undefined]) => {
        ensureSpan();

        try {
          const nextResult = (await originalNext(
            ...nextArgs,
          )) as IteratorResult<GoogleGenAIGenerateContentResponse>;

          if (!nextResult.done && nextResult.value) {
            if (firstTokenTime === null) {
              firstTokenTime = getCurrentUnixTimestamp();
            }
            chunks.push(nextResult.value);
          }

          if (nextResult.done) {
            finalize({
              result: aggregateGenerateContentChunks(
                chunks,
                requestStartTime,
                firstTokenTime,
              ),
            });
          }

          return nextResult;
        } catch (error) {
          finalize({ error });
          throw error;
        }
      };
    }

    if (originalReturn) {
      iteratorRecord.return = async (...returnArgs: [] | [unknown]) => {
        ensureSpan();

        try {
          return (await originalReturn(
            ...returnArgs,
          )) as IteratorResult<GoogleGenAIGenerateContentResponse>;
        } finally {
          if (chunks.length > 0) {
            finalize({
              result: aggregateGenerateContentChunks(
                chunks,
                requestStartTime,
                firstTokenTime,
              ),
            });
          } else {
            finalize({});
          }
        }
      };
    }

    if (originalThrow) {
      iteratorRecord.throw = async (...throwArgs: [] | [unknown]) => {
        ensureSpan();

        try {
          return (await originalThrow(
            ...throwArgs,
          )) as IteratorResult<GoogleGenAIGenerateContentResponse>;
        } catch (error) {
          finalize({ error });
          throw error;
        }
      };
    }

    iteratorRecord[Symbol.asyncIterator] = () => {
      const asyncIterator = originalAsyncIterator
        ? (originalAsyncIterator() as AsyncIterator<GoogleGenAIGenerateContentResponse>)
        : iterator;
      return patchIterator(asyncIterator);
    };

    return iterator;
  };

  patchIterator(result as AsyncIterator<GoogleGenAIGenerateContentResponse>);
  return true;
}
