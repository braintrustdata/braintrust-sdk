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
export type InvokeReturn<Stream extends boolean, Return> = Stream extends true
  ? BraintrustStream
  : Return;

// Update the InvokeFunctionArgs type
export type InvokeFunctionArgs<
  Arg,
  Return,
  Stream extends boolean = false,
> = FunctionId &
  FullLoginOptions & {
    arg: Arg;
    parent?: Exportable | string;
    state?: BraintrustState;
    stream?: Stream;
    schema?: z.ZodSchema<Return, z.ZodTypeDef, any>;
  };

// Implementation
export async function invoke<Arg, Return, Stream extends boolean = false>(
  args: InvokeFunctionArgs<Arg, Return, Stream>,
): Promise<InvokeReturn<Stream, Return>> {
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
    schema,
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
    return new BraintrustStream(resp.body) as InvokeReturn<Stream, Return>;
  } else {
    const data = await resp.json();
    return (schema ? schema.parse(data) : data) as InvokeReturn<Stream, Return>;
  }
}
