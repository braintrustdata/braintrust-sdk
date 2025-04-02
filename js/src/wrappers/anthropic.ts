import Anthropic from "@anthropic-ai/sdk";
import { startSpan } from "..";

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

const DEBUG = process.env.BRAINTRUST_DEBUG === "true";

function debug(...args: any[]) {
  if (DEBUG) {
    console.log(...args);
  }
}

export function wrapAnthropic(anthropic: Anthropic): Anthropic {
  debug(`wrapping anthropic ${anthropic}`);
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

      const promise = Reflect.apply(target, thisArg, argArray);
      if (promise instanceof Promise) {
        return promise.then((res) => {
          debug("messages.create returned", res);
          return res;
        });
      }
      return promise;
    },
  });
}
