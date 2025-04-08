import { Span } from "../logger";

type ParamsToSpanFunc = (params: any) => TimedSpan;
type ResultToEventFunc = (result: any) => {};
type TraceStreamFunc = (stream: AsyncIterator<any>, span: TimedSpan) => void;

type CreateProxyHooks = {
  name: string;
  toSpanFunc: ParamsToSpanFunc;
  resultToEventFunc: ResultToEventFunc;
  traceStreamFunc: TraceStreamFunc;
};

export function proxyCreate(
  target: any,
  hooks: CreateProxyHooks,
): (params: any) => Promise<any> {
  return new Proxy(target, {
    apply(target, thisArg, argArray) {
      if (!argArray || argArray.length === 0) {
        return Reflect.apply(target, thisArg, argArray);
      }
      const params = argArray[0];
      // Start the span with the given parameters
      const timedSpan = hooks.toSpanFunc(params);
      // Call the target function
      const apiPromise = Reflect.apply(target, thisArg, argArray);

      const onThen = function (result: any): Promise<any> | AsyncIterable<any> {
        if (params.stream) {
          return proxyIterable(result, timedSpan, hooks.traceStreamFunc);
        } else {
          const event = hooks.resultToEventFunc(result);
          const span = timedSpan.span;
          span.log(event);
          span.end();
          return result;
        }
      };

      // Return a proxy that will log the event and end the span
      return apiPromiseProxy(apiPromise, timedSpan, onThen);
    },
  });
}

function apiPromiseProxy(
  apiPromise: any,
  span: TimedSpan,
  onThen: (result: any) => any,
) {
  return new Proxy(apiPromise, {
    get(target, name, receiver) {
      if (name === "then") {
        const thenFunc = Reflect.get(target, name, receiver);
        return function (onF: any, onR: any) {
          return thenFunc.call(
            target,
            async (result: any) => {
              const processed = onThen(result);
              return onF ? onF(processed) : processed;
            },
            onR, // FIXME[matt] error handling?
          );
        };
      }
      return Reflect.get(target, name, receiver);
    },
  });
}

function proxyIterable<T>(
  stream: AsyncIterable<T>,
  span: TimedSpan,
  onNext: TraceStreamFunc,
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
                return onNext(iterator, span);
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

export type TimedSpan = {
  span: Span;
  start: number;
};
