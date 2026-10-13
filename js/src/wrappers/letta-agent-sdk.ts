import { lettaAgentSDKChannels as channels } from "../instrumentation/plugins/letta-agent-sdk-channels";
import type {
  LettaClient,
  LettaSDK,
  LettaSession,
} from "../vendor-sdk-types/letta-agent-sdk";

const wrapped = new WeakMap<object, object>();

/**
 * Trace a Letta Agent SDK module, client, or session using Braintrust's shared
 * instrumentation channels. Module wrapping instruments LettaAgentClient;
 * client/session wrapping installs idempotent methods on the supplied instance.
 */
export function wrapLettaAgentSDK<T>(sdk: T): T {
  if (!sdk || typeof sdk !== "object") return sdk;
  const existing = wrapped.get(sdk);
  if (existing) return existing as T;
  if (
    "send" in sdk &&
    typeof sdk.send === "function" &&
    "stream" in sdk &&
    typeof sdk.stream === "function" &&
    "close" in sdk &&
    typeof sdk.close === "function"
  ) {
    const session = sdk as unknown as LettaSession;
    if (!canPatch(session, ["send", "stream", "close"])) return sdk;
    const { send, stream, close } = session;
    Object.defineProperties(session, {
      send: method(function (
        this: LettaSession,
        ...args: Parameters<LettaSession["send"]>
      ) {
        return channels.send.invoke(send, this, args, {});
      }),
      stream: method(function (this: LettaSession) {
        return channels.stream.invoke(stream, this, [], {});
      }),
      close: method(function (this: LettaSession) {
        return channels.close.invoke(close, this, [], {});
      }),
    });
    wrapped.set(sdk, sdk);
    return sdk;
  }
  if (
    "createAgent" in sdk &&
    typeof sdk.createAgent === "function" &&
    "resumeSession" in sdk &&
    typeof sdk.resumeSession === "function" &&
    "createSession" in sdk &&
    typeof sdk.createSession === "function"
  ) {
    const client = sdk as unknown as LettaClient;
    if (!canPatch(client, ["createAgent", "resumeSession", "createSession"]))
      return sdk;
    const { createAgent, resumeSession, createSession } = client;
    Object.defineProperties(client, {
      createAgent: method(function (
        this: LettaClient,
        ...args: Parameters<LettaClient["createAgent"]>
      ) {
        return channels.createAgent.invoke(createAgent, this, args, {});
      }),
      resumeSession: method(function (
        this: LettaClient,
        ...args: Parameters<LettaClient["resumeSession"]>
      ) {
        return wrapLettaAgentSDK(
          channels.resumeSession.invoke(resumeSession, this, args, {}),
        );
      }),
      createSession: method(function (
        this: LettaClient,
        ...args: Parameters<LettaClient["createSession"]>
      ) {
        return wrapLettaAgentSDK(Reflect.apply(createSession, this, args));
      }),
    });
    wrapped.set(sdk, sdk);
    return sdk;
  }
  if ("LettaAgentClient" in sdk && typeof sdk.LettaAgentClient === "function") {
    const module = sdk as unknown as LettaSDK;
    const result = Object.create(sdk);
    Object.defineProperty(result, "LettaAgentClient", {
      value: new Proxy(module.LettaAgentClient, {
        construct(target, args, newTarget) {
          return wrapLettaAgentSDK(Reflect.construct(target, args, newTarget));
        },
      }),
      enumerable: true,
    });
    wrapped.set(sdk, result);
    wrapped.set(result, result);
    return result;
  }
  return sdk;
}

function method(value: unknown): PropertyDescriptor {
  return { value, configurable: true, writable: true };
}

function canPatch(value: object, names: string[]): boolean {
  return (
    Object.isExtensible(value) &&
    names.every((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      return !descriptor || descriptor.configurable;
    })
  );
}
