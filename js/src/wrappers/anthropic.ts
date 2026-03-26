import { anthropicChannels } from "../instrumentation/plugins/anthropic-channels";
import type {
  AnthropicAPIPromise,
  AnthropicBeta,
  AnthropicClient,
  AnthropicCreateParams,
  AnthropicMessage,
  AnthropicMessages,
  AnthropicStreamEvent,
} from "../vendor-sdk-types/anthropic";

type AnthropicResult = AnthropicMessage | AsyncIterable<AnthropicStreamEvent>;
type AnthropicChannel =
  | typeof anthropicChannels.messagesCreate
  | typeof anthropicChannels.betaMessagesCreate;
type AnthropicStartContext<TChannel extends AnthropicChannel> = Parameters<
  TChannel["tracePromise"]
>[1];

/**
 * Wrap an `Anthropic` object (created with `new Anthropic(...)`) so calls emit
 * tracing-channel events that Braintrust plugins can consume.
 *
 * Currently, this only supports the `v4` API.
 *
 * @param anthropic
 * @returns The wrapped `Anthropic` object.
 */
export function wrapAnthropic<T extends object>(anthropic: T): T {
  const au: unknown = anthropic;
  if (
    au &&
    typeof au === "object" &&
    "messages" in au &&
    typeof au.messages === "object" &&
    au.messages &&
    "create" in au.messages
  ) {
    return anthropicProxy(au as AnthropicClient) as T;
  }

  console.warn("Unsupported Anthropic library. Not wrapping.");
  return anthropic;
}

function anthropicProxy(anthropic: AnthropicClient): AnthropicClient {
  return new Proxy(anthropic, {
    get(target, prop, receiver) {
      switch (prop) {
        case "beta":
          return target.beta ? betaProxy(target.beta) : target.beta;
        case "messages":
          return messagesProxy(
            target.messages,
            anthropicChannels.messagesCreate,
          );
        default:
          return Reflect.get(target, prop, receiver);
      }
    },
  });
}

function betaProxy(beta: AnthropicBeta): AnthropicBeta {
  return new Proxy(beta, {
    get(target, prop, receiver) {
      if (prop === "messages") {
        return messagesProxy(
          target.messages,
          anthropicChannels.betaMessagesCreate,
        );
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

function messagesProxy(
  messages: AnthropicMessages,
  channel: AnthropicChannel,
): AnthropicMessages {
  return new Proxy(messages, {
    get(target, prop, receiver) {
      // NOTE[matt] We intentionally do not proxy `stream` directly because the
      // SDK implements it in terms of `create(stream=true)`.
      if (prop === "create") {
        return createProxy(target.create, channel);
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

function createProxy(
  create: AnthropicMessages["create"],
  channel: AnthropicChannel,
) {
  return new Proxy(create, {
    apply(target, thisArg, argArray) {
      if (argArray.length === 0) {
        return Reflect.apply(target, thisArg, argArray);
      }

      const params = argArray[0] as AnthropicCreateParams;
      const context = {
        arguments: [params],
      } as AnthropicStartContext<typeof channel>;

      return traceAnthropicPromise(
        channel,
        () =>
          Reflect.apply(
            target,
            thisArg,
            argArray,
          ) as AnthropicAPIPromise<AnthropicResult>,
        context,
      );
    },
  });
}

function traceAnthropicPromise<TChannel extends AnthropicChannel>(
  channel: TChannel,
  createPromise: () => AnthropicAPIPromise<AnthropicResult>,
  context: AnthropicStartContext<TChannel>,
): AnthropicAPIPromise<AnthropicResult> {
  const tracingChannel = channel.tracingChannel();
  const start = tracingChannel.start;
  const end = tracingChannel.end;
  const asyncStart = tracingChannel.asyncStart;
  const asyncEnd = tracingChannel.asyncEnd;
  const error = tracingChannel.error;

  if (!start || !end) {
    return createPromise();
  }

  return start.runStores(context, () => {
    start.publish(context);

    try {
      const result = createPromise();
      end.publish(context);

      void result.then(
        (resolved) => {
          (context as { result?: AnthropicResult }).result = resolved;
          asyncStart?.publish(context);
          asyncEnd?.publish(context);
        },
        (rejected) => {
          (context as { error?: unknown }).error = rejected;
          error?.publish(context);
        },
      );

      return result;
    } catch (rejected) {
      (context as { error?: unknown }).error = rejected;
      error?.publish(context);
      end.publish(context);
      throw rejected;
    }
  });
}
