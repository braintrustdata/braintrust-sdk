import { currentSpan } from "../../logger";
import type { Span } from "../../logger";

function proxyAssertion(
  assertion: unknown,
  value: unknown,
  key: string,
  span: Span,
): unknown {
  return new Proxy(assertion as object, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);

      if (typeof original === "function") {
        return function (...args: unknown[]) {
          let result: unknown;
          try {
            result = original.apply(target, args);
          } catch (err) {
            span.log({ output: { [key]: value }, scores: { [key]: 0 } });
            throw err;
          }

          if (
            result !== null &&
            typeof result === "object" &&
            typeof (result as Promise<unknown>).then === "function"
          ) {
            return (result as Promise<unknown>).then(
              (v) => {
                span.log({ output: { [key]: value }, scores: { [key]: 1 } });
                return v;
              },
              (err) => {
                span.log({ output: { [key]: value }, scores: { [key]: 0 } });
                throw err;
              },
            );
          }

          span.log({ output: { [key]: value }, scores: { [key]: 1 } });
          return result;
        };
      }

      if (original !== null && typeof original === "object") {
        return proxyAssertion(original, value, key, span);
      }

      return original;
    },
  });
}

export function wrapExpect<ExpectType>(originalExpect: ExpectType): ExpectType {
  const wrapped = function (value: unknown, message?: string) {
    // pass through unnamed expect
    if (message === undefined) {
      return (originalExpect as (v: unknown) => unknown)(value);
    }

    const assertion = (originalExpect as (v: unknown, m: string) => unknown)(
      value,
      message,
    );

    const span = currentSpan();
    if (!span) {
      return assertion;
    }

    return proxyAssertion(assertion, value, message, span);
  };

  Object.assign(wrapped, originalExpect);

  return wrapped as ExpectType;
}
