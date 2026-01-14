/* eslint-disable @typescript-eslint/no-explicit-any */
import { Attachment, Span, startSpan } from "../logger";
import { isObject, SpanTypeAttribute } from "../../util/index";
import { filterFrom, getCurrentUnixTimestamp } from "../util";
import { finalizeAnthropicTokens } from "./anthropic-tokens-util";

/**
 * Wrap an `Anthropic` object (created with `new Anthropic(...)`) to add tracing. If Braintrust is
 * not configured, nothing will be traced. If this is not an `Anthropic` object, this function is
 * a no-op.
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
    return anthropicProxy(au);
  } else {
    console.warn("Unsupported Anthropic library. Not wrapping.");
    return anthropic;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function anthropicProxy(anthropic: any): any {
  return new Proxy(anthropic, {
    get(target, prop, receiver) {
      switch (prop) {
        case "beta":
          return betaProxy(target.beta);
        case "messages":
          return messagesProxy(target.messages);
        default:
          return Reflect.get(target, prop, receiver);
      }
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function betaProxy(beta: any) {
  return new Proxy(beta, {
    get(target, prop, receiver) {
      if (prop === "messages") {
        return messagesProxy(target.messages);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messagesProxy(messages: any) {
  return new Proxy(messages, {
    get(target, prop, receiver) {
      // NOTE[matt] I didn't proxy `stream` because it's called by `create` under the hood. The callbacks
      // provided by `stream().on()` would made this job much easier. But we have to trace the more
      // primitive `create(stream=True)` anyway, so I opted to just have one (more arcane) means of
      // tracing both calls.
      switch (prop) {
        case "create":
          return createProxy(target.create);
        default:
          return Reflect.get(target, prop, receiver);
      }
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createProxy(create: (params: any) => Promise<any>) {
  return new Proxy(create, {
    apply(target, thisArg, argArray) {
      if (argArray.length === 0) {
        // this will fail anyway, so who cares.
        return Reflect.apply(target, thisArg, argArray);
      }

      const args = argArray[0];
      const input = coalesceInput(args["messages"] || [], args["system"]);
      const metadata = filterFrom(args, ["messages", "system"]);

      const spanArgs = {
        name: "anthropic.messages.create",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: processAttachmentsInInput(input),
          metadata: { ...metadata, provider: "anthropic" },
        },
        startTime: getCurrentUnixTimestamp(),
      };

      const span = startSpan(spanArgs);
      const sspan = { span, startTime: spanArgs.startTime };

      // Actually do the call.
      const apiPromise = Reflect.apply(target, thisArg, argArray);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onThen: ThenFn<any> = function (msgOrStream: any) {
        // handle the sync interface create(stream=False)
        if (!args["stream"]) {
          const ttft = getCurrentUnixTimestamp() - sspan.startTime;
          const event = parseEventFromMessage(msgOrStream);
          span.log({
            ...event,
            metrics: event.metrics
              ? finalizeAnthropicTokens({
                  ...event.metrics,
                  time_to_first_token: ttft,
                })
              : { time_to_first_token: ttft },
          });
          span.end();
          return msgOrStream;
        }

        // ... or the async interface when create(stream=True)
        return streamProxy(msgOrStream, sspan);
      };

      return apiPromiseProxy(apiPromise, sspan, onThen);
    },
  });
}

type ThenFn<T> = Promise<T>["then"];

function apiPromiseProxy<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiPromise: any,
  span: StartedSpan,
  onThen: ThenFn<T>,
) {
  return new Proxy(apiPromise, {
    get(target, prop, receiver) {
      if (prop === "then") {
        // This path is used with messages.create(stream=True) calls.
        const thenFunc = Reflect.get(target, prop, receiver);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return function (onFulfilled: any, onRejected: any) {
          return thenFunc.call(
            target,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async (result: any) => {
              try {
                const processed = onThen(result);
                return onFulfilled ? onFulfilled(processed) : processed;
              } catch (error) {
                return onRejected ? onRejected(error) : Promise.reject(error);
              }
            },
            onRejected,
          );
        };
      } else if (prop === "withResponse") {
        // This path is used with messages.stream(...) calls.
        const withResponseFunc = Reflect.get(target, prop, receiver);
        return () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return withResponseFunc.call(target).then((withResponse: any) => {
            if (withResponse["data"]) {
              const { data: stream } = withResponse;
              withResponse.data = streamProxy(stream, span);
            }
            return Promise.resolve(withResponse);
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

//  Here's a little example of the stream format:
//
//  item {
//    type: 'message_start',
//    message: {
//      id: 'msg_01HztKSUHcjytk5L7p2qxNsK',
//      type: 'message',
//      role: 'assistant',
//      model: 'claude-3-haiku-20240307',
//      content: [],
//      stop_reason: null,
//      stop_sequence: null,
//      usage: {
//        input_tokens: 49,
//        cache_creation_input_tokens: 0,
//        cache_read_input_tokens: 0,
//        output_tokens: 1
//      }
//    }
//  }
//  item {
//    type: 'content_block_delta',
//    index: 0,
//    delta: { type: 'text_delta', text: 'abc123 }
//  }
//  item { type: 'content_block_stop', index: 0 }
//  item {
//    type: 'message_delta',
//    delta: { stop_reason: 'end_turn', stop_sequence: null },
//    usage: { output_tokens: 187 }
//  }
//  item { type: 'message_stop' }

function streamProxy<T>(
  stream: AsyncIterable<T>,
  span: StartedSpan,
): AsyncIterable<T> {
  // Set up the scaffolding to proxy the stream. This is necessary because the stream
  // has other things that get called (e.g. controller.signal)
  return new Proxy(stream, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        const original = Reflect.get(target, prop, receiver);
        return function () {
          const iterator: AsyncIterator<T> = original.call(target);
          return new Proxy(iterator, {
            get(iterTarget, iterProp, iterReceiver) {
              // Intercept the 'next' method
              if (iterProp === "next") {
                return streamNextProxy(iterator, span);
              }
              return Reflect.get(iterTarget, iterProp, iterReceiver);
            },
          });
        };
      }
      // For other properties, just pass them through
      return Reflect.get(target, prop, receiver);
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function streamNextProxy(stream: AsyncIterator<any>, sspan: StartedSpan) {
  // this is where we actually do the business of iterating the message stream
  let ttft = -1;
  let metadata = {};
  let totals: Metrics = {};
  const span = sspan.span;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = [];
  const contentBlockDeltas: Record<number, string[]> = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async function <T>(...args: [any]): Promise<IteratorResult<T>> {
    const result = await stream.next(...args);

    if (ttft < 0) {
      ttft = getCurrentUnixTimestamp() - sspan.startTime;
      totals.time_to_first_token = ttft;
    }

    if (result.done) {
      span.log({
        metrics: finalizeAnthropicTokens(totals),
        metadata: metadata,
      });
      span.end();
      return result;
    }

    const item = result.value;
    const blockIndex = item.index;
    switch (item?.type) {
      case "message_start":
        const msg = item?.message;
        if (msg) {
          const event = parseEventFromMessage(msg);
          totals = { ...totals, ...event.metrics }; // save the first copy of our metrics.
          span.log(event);
        }
        break;
      case "content_block_start":
        // Track content blocks including images
        if (item.content_block) {
          contentBlocks[blockIndex] = item.content_block;
          contentBlockDeltas[blockIndex] = [];
        }
        break;
      case "content_block_delta":
        if (!contentBlockDeltas[blockIndex]) {
          contentBlockDeltas[blockIndex] = [];
        }
        if (item.delta?.type === "text_delta") {
          const text = item?.delta?.text;
          if (text) {
            contentBlockDeltas[blockIndex].push(text);
          }
        } else if (item.delta?.type === "input_json_delta") {
          const partialJson = item?.delta?.partial_json;
          if (partialJson) {
            contentBlockDeltas[blockIndex].push(partialJson);
          }
        }
        break;
      case "content_block_stop":
        const text = contentBlockDeltas[blockIndex]?.join("");
        if (!text) break;

        const block = contentBlocks[blockIndex];
        if (block?.type === "tool_use") {
          try {
            span.log({
              output: {
                role: item.role,
                content: [{ ...block, input: JSON.parse(text) }],
              },
            });
          } catch {
            span.log({ output: text });
          }
        } else {
          span.log({ output: text });
        }
        break;

      case "message_delta":
        // Collect stats + metadata about the message.
        const usage = item?.usage;
        if (usage) {
          const metrics = parseMetricsFromUsage(usage);
          totals = { ...totals, ...metrics }; // update our totals.
        }
        const delta = item?.delta;
        if (delta) {
          // stop reason, etc.
          metadata = { ...metadata, ...delta };
        }
        break;
      case "message_stop":
        break;
    }

    return result;
  };
}

type StartedSpan = {
  span: Span;
  startTime: number;
};

type Metrics = Record<string, number>;
type MetricsOrUndefined = Metrics | undefined;

// Parse the event from given anthropic Message.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEventFromMessage(message: any) {
  // FIXME[matt] the whole content or just the text?
  const output = message
    ? { role: message.role, content: message.content }
    : null;
  const metrics = parseMetricsFromUsage(message?.usage);
  const metas = ["stop_reason", "stop_sequence"];
  const metadata: Record<string, unknown> = {};
  for (const m of metas) {
    if (message[m] !== undefined) {
      metadata[m] = message[m];
    }
  }

  return {
    output: output,
    metrics: metrics,
    metadata: metadata,
  };
}

// Parse the metrics from the usage object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMetricsFromUsage(usage: any): MetricsOrUndefined {
  if (!usage) {
    return undefined;
  }

  const metrics: Metrics = {};

  function saveIfExistsTo(source: string, target: string) {
    const value = usage[source];
    if (value !== undefined && value !== null) {
      metrics[target] = value;
    }
  }

  saveIfExistsTo("input_tokens", "prompt_tokens");
  saveIfExistsTo("output_tokens", "completion_tokens");
  saveIfExistsTo("cache_read_input_tokens", "prompt_cached_tokens");
  saveIfExistsTo("cache_creation_input_tokens", "prompt_cache_creation_tokens");

  return metrics;
}

// Helper function to convert base64 content to an Attachment
function convertBase64ToAttachment(
  source: any,
  contentType: "image" | "document",
): any {
  const mediaType =
    typeof source.media_type === "string" ? source.media_type : "image/png";
  const base64Data = source.data;

  if (base64Data && typeof base64Data === "string") {
    // Convert base64 string to Blob
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mediaType });

    // Determine file extension from media type
    const extension = mediaType.split("/")[1] || "bin";
    // Use a descriptive prefix based on content type
    const prefix = contentType === "document" ? "document" : "image";
    const filename = `${prefix}.${extension}`;

    const attachment = new Attachment({
      data: blob,
      filename: filename,
      contentType: mediaType,
    });

    return {
      ...source,
      data: attachment,
    };
  }

  return source;
}

// Process input to convert base64 attachments (images, PDFs, etc.) to Attachment objects
function processAttachmentsInInput(input: any): any {
  if (Array.isArray(input)) {
    return input.map(processAttachmentsInInput);
  }

  if (isObject(input)) {
    // Check for Anthropic's content blocks with base64 data
    // Supports both "image" and "document" types (for PDFs, etc.)
    if (
      (input.type === "image" || input.type === "document") &&
      isObject(input.source) &&
      input.source.type === "base64"
    ) {
      return {
        ...input,
        source: convertBase64ToAttachment(input.source, input.type),
      };
    }

    // Recursively process nested objects
    const processed: any = {};
    for (const [key, value] of Object.entries(input)) {
      processed[key] = processAttachmentsInInput(value);
    }
    return processed;
  }

  return input;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function coalesceInput(messages: any[], system: string | undefined) {
  // convert anthropic args to the single "input" field Braintrust expects.

  // Make a copy because we're going to mutate it.
  const input = (messages || []).slice();
  if (system) {
    input.push({ role: "system", content: system });
  }
  return input;
}
