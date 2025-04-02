import Anthropic from "@anthropic-ai/sdk";
import { startSpan } from "..";
import { SpanTypeAttribute } from "@braintrust/core";
import { debugLog } from "../util";

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

      const args = { ...argArray[0] };

      // Now actually trace messages.create.
      const spanArgs = {
        name: "anthropic.messages.create",
        spanAttributes: {
          type: SpanTypeAttribute.LLM,
        },
        event: {
          input: coalesceInput(args["messages"], args["system"]),
          metadata: filterFrom(args, ["messages", "system"]),
        },
      };

      const span = startSpan(spanArgs);

      const promise = Reflect.apply(target, thisArg, argArray);
      if (promise instanceof Promise) {
        return promise.then((res) => {
          span.log({ output: res.content });
          debugLog("messages.create returned", res);
          span.end();
          return res;
        });
      }
      return promise;
    },
  });
}

function coalesceInput(messages: any[], system: string | undefined) {
  // convert anthropic args to the single "input" field Braintrust expects.
  var input = (messages || []).slice();
  if (system) {
    input.push({ role: "system", content: system });
  }
  return input;
}

// Remove a copy of rec with the given keys removed.
function filterFrom(record: Record<string, any>, keys: string[]) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(record)) {
    if (!keys.includes(k)) {
      out[k] = record[k];
    }
  }
  return out;
}
