import Anthropic from "@anthropic-ai/sdk";
import Stream from "@anthropic-ai/sdk";
import { Span, startSpan } from "..";
import { SpanTypeAttribute } from "@braintrust/core";
import { getCurrentUnixTimestamp } from "../util";
import {
  Message,
  Usage,
  RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages";
const METADATA_PARAMS = [
  "model",
  "max_tokens",
  "temperature",
  "top_k",
  "top_p",
  "stop_sequences",
  "tool_choice",
  "tools",
];

export function wrapAnthropic(anthropic: Anthropic): Anthropic {
  return anthropicProxy(anthropic);
}

function anthropicProxy(anthropic: Anthropic): Anthropic {
  return new Proxy(anthropic, {
    get(target, prop, receiver) {
      if (prop === "messages") {
        return messagesProxy(target.messages);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function messagesProxy(messages: any) {
  return new Proxy(messages, {
    get(target, prop, receiver) {
      if (prop === "create") {
        return createProxy(target.create);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

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
          provider: "anthropic",
        },
        event: {
          input,
          metadata,
        },
      };

      const span = startSpan(spanArgs);

      const promise = Reflect.apply(target, thisArg, argArray);
      if (promise instanceof Promise) {
        return promise.then((msgOrStream) => {
          // handle the sync interface
          if (!args["stream"]) {
            const event = parseEventFromMessage(msgOrStream);
            span.log(event);
            span.end();
            return msgOrStream;
          }
          // ... or the async interface.
          return new WrapperStream(
            span,
            getCurrentUnixTimestamp(),
            msgOrStream,
          );
        });
      }
      return promise;
    },
  });
}

type Metrics = Record<string, number>;
type MetricsOrUndefined = Metrics | undefined;

// Parse the event from given anthropic Message.
function parseEventFromMessage(message: Message) {
  // FIXME[matt] the whole content or just the text?
  let output = message?.content || null;

  const metrics = parseMetricsFromUsage(message?.usage);

  const metas = ["stop_reason", "stop_sequence"];

  const metadata: Record<string, any> = {};
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
  saveIfExistsTo("cache_read_input_tokens", "cache_read_input_tokens");
  saveIfExistsTo("cache_creation_input_tokens", "cache_creation_input_tokens");

  metrics["tokens"] =
    (metrics.prompt_tokens || 0) + (metrics.completion_tokens || 0);

  return metrics;
}

function coalesceInput(messages: any[], system: string | undefined) {
  // convert anthropic args to the single "input" field Braintrust expects.

  // Make a copy because we're going to mutate it.
  var input = (messages || []).slice();
  if (system) {
    input.push({ role: "system", content: system });
  }
  return input;
}

// Return a copy of record with the given keys removed.
function filterFrom(record: Record<string, any>, keys: string[]) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(record)) {
    if (!keys.includes(k)) {
      out[k] = record[k];
    }
  }
  return out;
}

class WrapperStream<Item> implements AsyncIterable<Item> {
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

  private span: Span;
  private iter: AsyncIterable<Item>;
  private startTime: number;
  private usage: Record<string, number>;

  constructor(span: Span, startTime: number, iter: AsyncIterable<Item>) {
    this.span = span;
    this.iter = iter;
    this.startTime = startTime;
    this.usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Item, any, undefined> {
    let ttft = -1;
    const deltas = [];
    let metadata = {};
    let totals: Metrics = {};
    try {
      for await (const item of this.iter) {
        // note the time to first token
        if (ttft < 0) {
          ttft = getCurrentUnixTimestamp() - this.startTime;
          this.span.log({ metrics: { time_to_first_token: ttft } });
        }

        switch (item?.type) {
          case "message_start":
            const msg = item?.message;
            if (msg) {
              const event = parseEventFromMessage(msg);
              totals = { ...totals, ...event.metrics }; // save the first copy of our metrics.
              this.span.log(event);
            }
            break;
          case "content_block_delta":
            // Collect the running output.
            if (item.delta?.type === "text_delta") {
              const text = item?.delta?.text;
              if (text) {
                deltas.push(text);
              }
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
        yield item;
      }
    } finally {
      totals.tokens =
        (totals["prompt_tokens"] || 0) + (totals["completion_tokens"] || 0);
      const output = deltas.join("");
      this.span.log({ output: output, metrics: totals, metadata: metadata });
      this.span.end();
    }
  }
}
