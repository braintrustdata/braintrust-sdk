import Anthropic from "@anthropic-ai/sdk";
import { Span, startSpan } from "..";
import { SpanTypeAttribute } from "@braintrust/core";
import { debugLog } from "../util";
import { Message, Usage } from "@anthropic-ai/sdk/resources/messages";
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
  debugLog(`wrapping anthropic ${anthropic}`);
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
        return promise.then((msg) => {
          debugLog("messages.create returned", msg);

          try {
            handleCreateResponse(msg, span);
          } catch (err) {
            debugLog("handleCreateResponse error", err);
          } finally {
            span.end();
          }

          return msg;
        });
      }
      return promise;
    },
  });
}

type MetricsOrUndefined = Record<string, number> | undefined;

// Parse the data from the anthropic response and log it to the span.
function handleCreateResponse(message: Message, span: Span) {
  // FIXME[matt] the whole content or just the text?
  let output = message?.content || null;

  const metrics = parseMetricsFromUsage(message?.usage);

  const metas = ["stop_reason", "stop_sequence"];

  const metadata = {
    stop_reason: message?.stop_reason,
    stop_sequence: message?.stop_sequence,
  };
  const event = {
    output: output,
    metrics: metrics,
    metadata: metadata,
  };

  span.log(event);
}

function parseMetricsFromUsage(usage: any): MetricsOrUndefined {
  if (!usage) {
    return undefined;
  }

  const metrics: Record<string, number> = {};

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
