import {
  InvokeFunctionRequest,
  FunctionId,
  INVOKE_API_VERSION,
} from "@braintrust/core/typespecs";
import {
  _internalGetGlobalState,
  BraintrustState,
  currentSpan,
  Exportable,
  FullLoginOptions,
} from "../logger";
import { BraintrustStream } from "../stream";
import { z } from "zod";

// Define a type for the return value
export type InvokeReturn<S extends boolean, R> = S extends true
  ? BraintrustStream
  : R;

// Update the InvokeFunctionArgs type
export type InvokeFunctionArgs<T, R, S extends boolean = false> = FunctionId &
  FullLoginOptions & {
    arg: T;
    parent?: Exportable | string;
    state?: BraintrustState;
    stream?: S;
    returnSchema?: z.ZodSchema<R, z.ZodTypeDef, any>;
  };

// Update the invoke function
export async function invoke<T, R, S extends boolean = false>(
  args: InvokeFunctionArgs<T, R, S>,
): Promise<InvokeReturn<S, R>> {
  const {
    orgName,
    apiKey,
    appUrl,
    forceLogin,
    fetch,
    arg,
    parent: parentArg,
    state: stateArg,
    stream,
    returnSchema,
    ...functionId
  } = args;

  const state = stateArg ?? _internalGetGlobalState();
  await state.login({
    orgName: orgName,
    apiKey,
    appUrl,
    forceLogin,
  });

  const parent = parentArg
    ? typeof parentArg === "string"
      ? parentArg
      : await parentArg.export()
    : await currentSpan().export();

  const request: InvokeFunctionRequest = {
    ...functionId,
    arg,
    parent,
    stream,
    api_version: INVOKE_API_VERSION,
  };

  const resp = await state.proxyConn().post(`function/invoke`, request, {
    headers: {
      Accept: stream ? "text/event-stream" : "application/json",
    },
  });

  if (stream) {
    if (!resp.body) {
      throw new Error("Received empty stream body");
    }
    return new BraintrustStream(resp.body) as InvokeReturn<S, R>;
  } else {
    const data = await resp.json();
    // Validate the returned data against the schema if provided
    if (returnSchema) {
      return returnSchema.parse(data) as InvokeReturn<S, R>;
    }
    return data as InvokeReturn<S, R>;
  }
}
