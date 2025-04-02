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

type MetricsOrNull = Record<string, number> | null;

// Parse the data from the anthropic response and log it to the span.
function handleCreateResponse(message: Message, span: Span) {
  // FIXME[matt] the whole content or just the text?
  let output = message?.content || null;

  const metrics = parseMetricsFromUsage(message?.usage);

  const event = {
    output: output,
    metrics: metrics,
  };

  span.log(event);
}

function parseMetricsFromUsage(usage: any): MetricsOrNull {
  if (!usage) {
    return null;
  }
  return {
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
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
