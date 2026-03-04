import { tracingChannel } from "dc-browser";
import { OPENAI_CHANNEL } from "../instrumentation/plugins/channels";
import { parseMetricsFromUsage } from "../openai-utils";
import {
  APIPromise,
  ChannelContext,
  createLazyAPIPromise,
  EnhancedResponse,
  tracePromiseWithResponse,
} from "./openai-promise-utils";

type SpanInfo = {
  span_info?: Record<string, unknown>;
};

export function responsesProxy(openai: any) {
  // This was added in v4.87.0 of the openai-node library
  if (!openai.responses) {
    return openai;
  }

  return new Proxy(openai.responses, {
    get(target, name, receiver) {
      if (name === "create") {
        return wrapResponsesAsync(
          target.create.bind(target),
          OPENAI_CHANNEL.RESPONSES_CREATE,
        );
      } else if (name === "stream") {
        return wrapResponsesSyncStream(
          target.stream.bind(target),
          OPENAI_CHANNEL.RESPONSES_STREAM,
        );
      } else if (name === "parse") {
        return wrapResponsesAsync(
          target.parse.bind(target),
          OPENAI_CHANNEL.RESPONSES_PARSE,
        );
      }
      return Reflect.get(target, name, receiver);
    },
  });
}

function wrapResponsesAsync<TParams, TResult>(
  target: (params: TParams, options?: unknown) => APIPromise<TResult>,
  channelName: string,
): (params: TParams & SpanInfo, options?: unknown) => APIPromise<TResult> {
  return (
    allParams: TParams & SpanInfo,
    options?: unknown,
  ): APIPromise<TResult> => {
    const { span_info, ...params } = allParams;

    let executionPromise: Promise<EnhancedResponse<TResult>> | null = null;

    const ensureExecuted = (): Promise<EnhancedResponse<TResult>> => {
      if (!executionPromise) {
        executionPromise = (async () => {
          const traceContext: ChannelContext = {
            arguments: [params],
            span_info,
          };
          const apiPromise = target(params as TParams, options);
          return tracePromiseWithResponse(
            channelName,
            traceContext,
            apiPromise,
          );
        })();
      }

      return executionPromise;
    };

    return createLazyAPIPromise(ensureExecuted);
  };
}

function wrapResponsesSyncStream<TParams, TResult>(
  target: (params: TParams, options?: unknown) => TResult,
  channelName: string,
): (params: TParams & SpanInfo, options?: unknown) => TResult {
  return (allParams: TParams & SpanInfo, options?: unknown): TResult => {
    const { span_info, ...params } = allParams;
    const channel = tracingChannel(channelName);
    return channel.traceSync(() => target(params as TParams, options), {
      arguments: [params],
      span_info,
    });
  };
}

export { parseMetricsFromUsage };
