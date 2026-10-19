import {
  channel,
  defineInterceptor,
} from "../instrumentation/core/interceptor-definitions";

export const consoleMethods = [
  "log",
  "trace",
  "debug",
  "info",
  "warn",
  "error",
] as const;
export type ConsoleMethod = (typeof consoleMethods)[number];
export type LogConsole = Pick<Console, ConsoleMethod>;

export const consoleHooks = defineInterceptor("console", {
  write: channel<
    unknown[],
    void,
    { registration: object; method: ConsoleMethod }
  >({ channelName: "write" }),
});

const WRAPPED = Symbol.for("braintrust.consoleWrapped");

/** Install invocation hooks in place. The registration token is opaque to wrapping. */
export function wrapConsoleMethods(
  target: LogConsole,
  registration: object,
): void {
  for (const method of consoleMethods) {
    const original = target[method];
    if (typeof original !== "function") continue;
    const existing: unknown = Reflect.get(original, WRAPPED);
    if (
      typeof existing === "object" &&
      existing !== null &&
      "registration" in existing
    ) {
      existing.registration = registration;
      continue;
    }
    const state = { registration };
    target[method] = Object.assign(
      function (...args: unknown[]) {
        return consoleHooks.write.invoke(original, target, args, {
          registration: state.registration,
          method,
        });
      },
      { [WRAPPED]: state },
    );
  }
}
