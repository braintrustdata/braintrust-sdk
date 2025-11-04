import { getCurrentUnixTimestamp, filterFrom, objectIsEmpty } from "../util";
import { Span, startSpan, Attachment } from "../logger";
import { isObject } from "../../util/index";

export function responsesProxy(openai: any) {
  // This was added in v4.87.0 of the openai-node library
  if (!openai.responses) {
    return openai;
  }

  return new Proxy(openai.responses, {
    get(target, name, receiver) {
      if (name === "create") {
        return responsesCreateProxy(target.create.bind(target));
      } else if (name === "stream") {
        return responsesStreamProxy(target.stream.bind(target));
      } else if (name === "parse") {
        return responsesParseProxy(target.parse.bind(target));
      }
      return Reflect.get(target, name, receiver);
    },
  });
}

function responsesCreateProxy(target: any): (params: any) => Promise<any> {
  const hooks = {
    name: "openai.responses",
    toSpanFunc: parseSpanFromResponseCreateParams,
    resultToEventFunc: parseEventFromResponseCreateResult,
    traceStreamFunc: traceResponseCreateStream,
  };

  return proxyCreate(target, hooks);
}

// convert response.create params into a span
function parseSpanFromResponseCreateParams(params: any): TimedSpan {
  const spanArgs = {
    name: "openai.responses.create",
    spanAttributes: {
      type: "llm",
    },
    event: {
      input: params.input,
      metadata: {
        ...filterFrom(params, ["input"]),
        provider: "openai",
      },
    },
    startTime: getCurrentUnixTimestamp(),
  };
  return {
    span: startSpan(spanArgs),
    start: spanArgs.startTime,
  };
}

// convert response.create result into an event
function parseEventFromResponseCreateResult(result: any) {
  const data: Record<string, any> = {};

  if (result?.output !== undefined) {
    data.output = processImagesInOutput(result.output);
  }

  // Extract metadata - preserve all response fields except output and usage
  if (result) {
    const { output, usage, ...metadata } = result;
    if (Object.keys(metadata).length > 0) {
      data.metadata = metadata;
    }
  }

  // Extract metrics from usage
  data.metrics = parseMetricsFromUsage(result?.usage);

  return data;
}

// Process output to convert base64 images to attachments
function processImagesInOutput(output: any): any {
  if (Array.isArray(output)) {
    return output.map(processImagesInOutput);
  }

  if (isObject(output)) {
    if (
      output.type === "image_generation_call" &&
      output.result &&
      typeof output.result === "string"
    ) {
      const fileExtension = output.output_format || "png";
      const contentType = `image/${fileExtension}`;

      const baseFilename =
        output.revised_prompt && typeof output.revised_prompt === "string"
          ? output.revised_prompt.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "_")
          : "generated_image";
      const filename = `${baseFilename}.${fileExtension}`;

      // Convert base64 string to Blob
      const binaryString = atob(output.result);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: contentType });

      const attachment = new Attachment({
        data: blob,
        filename: filename,
        contentType: contentType,
      });

      return {
        ...output,
        result: attachment,
      };
    }
  }

  return output;
}

// convert response.parse params into a span
function parseSpanFromResponseParseParams(params: any): TimedSpan {
  const spanArgs = {
    name: "openai.responses.parse",
    spanAttributes: {
      type: "llm",
    },
    event: {
      input: params.input,
      metadata: {
        ...filterFrom(params, ["input"]),
        provider: "openai",
      },
    },
    startTime: getCurrentUnixTimestamp(),
  };
  return {
    span: startSpan(spanArgs),
    start: spanArgs.startTime,
  };
}

// convert response.parse result into an event
function parseEventFromResponseParseResult(result: any) {
  const data: Record<string, any> = {};

  if (result?.output !== undefined) {
    data.output = processImagesInOutput(result.output);
  }

  // Extract metadata - preserve all response fields except output and usage
  if (result) {
    const { output, usage, ...metadata } = result;
    if (Object.keys(metadata).length > 0) {
      data.metadata = metadata;
    }
  }

  // Extract metrics from usage
  data.metrics = parseMetricsFromUsage(result?.usage);

  return data;
}

function traceResponseCreateStream(
  stream: AsyncIterator<any>,
  timedSpan: TimedSpan,
) {
  const span = timedSpan.span;
  let ttft = -1;
  return async function <T>(...args: [any]): Promise<IteratorResult<T>> {
    const result = await stream.next(...args);

    if (ttft === -1) {
      ttft = getCurrentUnixTimestamp() - timedSpan.start;
      span.log({ metrics: { time_to_first_token: ttft } });
    }

    if (result.done) {
      span.end();
      return result;
    }

    const item = result.value;
    if (!item || !item?.type || !item?.response) {
      return result; // unexpected
    }

    const event = parseLogFromItem(item);
    if (!objectIsEmpty(event)) {
      span.log(event);
    }
    return result;
  };
}

function parseLogFromItem(item: any): {} {
  if (!item || !item?.type || !item?.response) {
    return {};
  }

  const response = item.response;
  switch (item.type) {
    case "response.completed":
      const data: Record<string, any> = {};

      if (response?.output !== undefined) {
        data.output = processImagesInOutput(response.output);
      }

      // Extract metadata - preserve response fields except usage and output
      if (response) {
        const { usage, output, ...metadata } = response;
        if (Object.keys(metadata).length > 0) {
          data.metadata = metadata;
        }
      }

      // Extract metrics from usage
      data.metrics = parseMetricsFromUsage(response?.usage);

      return data;
    default:
      return {};
  }
}

function responsesStreamProxy(target: any): (params: any) => Promise<any> {
  return new Proxy(target, {
    apply(target, thisArg, argArray) {
      const responseStream: any = Reflect.apply(target, thisArg, argArray);
      if (!argArray || argArray.length === 0) {
        return responseStream;
      }

      const timedSpan = parseSpanFromResponseCreateParams(argArray[0]);
      const span = timedSpan.span;

      let ttft = -1;

      responseStream.on("event", (event: any) => {
        if (ttft === -1) {
          ttft = getCurrentUnixTimestamp() - timedSpan.start;
          span.log({ metrics: { time_to_first_token: ttft } });
        }
        const logEvent = parseLogFromItem(event);
        if (!objectIsEmpty(logEvent)) {
          span.log(logEvent);
        }
      });

      responseStream.on("end", () => {
        span.end();
      });

      return responseStream;
    },
  });
}

function responsesParseProxy(target: any): (params: any) => Promise<any> {
  const hooks = {
    name: "openai.responses.parse",
    toSpanFunc: parseSpanFromResponseParseParams,
    resultToEventFunc: parseEventFromResponseParseResult,
    traceStreamFunc: traceResponseCreateStream, // Reuse the same stream tracing
  };

  return proxyCreate(target, hooks);
}

const TOKEN_NAME_MAP: Record<string, string> = {
  input_tokens: "prompt_tokens",
  output_tokens: "completion_tokens",
  total_tokens: "tokens",
};

const TOKEN_PREFIX_MAP: Record<string, string> = {
  input: "prompt",
  output: "completion",
};

export function parseMetricsFromUsage(usage: unknown): Record<string, number> {
  if (!usage) {
    return {};
  }

  // example : {
  //   input_tokens: 14,
  //   input_tokens_details: { cached_tokens: 0 },
  //   output_tokens: 8,
  //   output_tokens_details: { reasoning_tokens: 0 },
  //   total_tokens: 22
  // }

  const metrics: Record<string, number> = {};

  for (const [oai_name, value] of Object.entries(usage)) {
    if (typeof value === "number") {
      const metricName = TOKEN_NAME_MAP[oai_name] || oai_name;
      metrics[metricName] = value;
    } else if (oai_name.endsWith("_tokens_details")) {
      if (!isObject(value)) {
        continue;
      }
      const rawPrefix = oai_name.slice(0, -"_tokens_details".length);
      const prefix = TOKEN_PREFIX_MAP[rawPrefix] || rawPrefix;
      for (const [key, n] of Object.entries(value)) {
        if (typeof n !== "number") {
          continue;
        }
        const metricName = `${prefix}_${key}`;
        metrics[metricName] = n;
      }
    }
  }

  return metrics;
}

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
          const event: any = hooks.resultToEventFunc(result);
          const span = timedSpan.span;

          // Calculate time to first token for non-streaming responses
          const ttft = getCurrentUnixTimestamp() - timedSpan.start;
          if (!event.metrics) {
            event.metrics = {};
          }
          event.metrics.time_to_first_token = ttft;

          span.log(event);
          span.end();
          return result;
        }
      };

      // Return a proxy that will log the event and end the span
      return apiPromiseProxy(
        apiPromise,
        timedSpan,
        onThen,
        hooks.traceStreamFunc,
      );
    },
  });
}

function apiPromiseProxy(
  apiPromise: any,
  span: TimedSpan,
  onThen: (result: any) => any,
  traceStreamFunc: TraceStreamFunc,
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
