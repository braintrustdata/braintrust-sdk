import { Anthropic } from "@anthropic-ai/sdk";
const DEBUG = true;

function debug(message: string) {
  if (DEBUG) {
    console.log(message);
  }
}

export function wrapAnthropic(anthropic: Anthropic): Anthropic {
  debug(`wrapping anthropic ${anthropic}`);

  const proxy = new Proxy(anthropic, {
    get(target, prop, receiver) {
      debug(`getting ${prop}`);
      return Reflect.get(target, prop, receiver);
    },
  });

  return proxy as T;
}
