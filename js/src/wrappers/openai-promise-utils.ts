import iso from "../isomorph";

export type EnhancedResponse<T> = {
  response: Response;
  data: T;
};

export interface APIPromise<T> extends Promise<T> {
  withResponse(): Promise<EnhancedResponse<T>>;
}

export type ChannelContext = {
  arguments: unknown[];
  span_info?: unknown;
  response?: Response;
};

export async function tracePromiseWithResponse<T>(
  channelName: string,
  traceContext: ChannelContext,
  apiPromise: APIPromise<T>,
): Promise<EnhancedResponse<T>> {
  const channel = iso.newTracingChannel(channelName);
  let enhancedResponse: EnhancedResponse<T> | undefined;

  const data = await channel.tracePromise(async () => {
    enhancedResponse = await apiPromise.withResponse();
    traceContext.response = enhancedResponse.response;
    return enhancedResponse.data;
  }, traceContext);

  if (!enhancedResponse) {
    throw new Error("Expected withResponse() to provide response");
  }

  return { data, response: enhancedResponse.response };
}

export function createLazyAPIPromise<TResult>(
  ensureExecuted: () => Promise<EnhancedResponse<TResult>>,
): APIPromise<TResult> {
  let dataPromise: Promise<TResult> | null = null;

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return new Proxy({} as APIPromise<TResult>, {
    get(target, prop, receiver) {
      if (prop === "withResponse") {
        return () => ensureExecuted();
      }

      if (
        prop === "then" ||
        prop === "catch" ||
        prop === "finally" ||
        prop in Promise.prototype
      ) {
        if (!dataPromise) {
          dataPromise = ensureExecuted().then((result) => result.data);
        }
        const value = Reflect.get(dataPromise, prop, receiver);
        return typeof value === "function" ? value.bind(dataPromise) : value;
      }

      return Reflect.get(target, prop, receiver);
    },
  }) as APIPromise<TResult>;
}
