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
  getSpanParentObject,
} from "../logger";
import { BraintrustStream } from "./stream";
import { z } from "zod";

// Define a type for the return value
export type InvokeReturn<Stream extends boolean, Output> = Stream extends true
  ? BraintrustStream
  : Output;

// Update the InvokeFunctionArgs type
export type InvokeFunctionArgs<
  Input,
  Output,
  Stream extends boolean = false,
> = FunctionId &
  FullLoginOptions & {
    input: Input;
    parent?: Exportable | string;
    state?: BraintrustState;
    stream?: Stream;
    schema?: z.ZodSchema<Output>;
  };

// Implementation
export async function invoke<Input, Output, Stream extends boolean = false>(
  args: InvokeFunctionArgs<Input, Output, Stream>,
): Promise<InvokeReturn<Stream, Output>> {
  const {
    orgName,
    apiKey,
    appUrl,
    forceLogin,
    fetch,
    input,
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
    : await getSpanParentObject().export();

  const request: InvokeFunctionRequest = {
    ...functionId,
    input,
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
    return new BraintrustStream(resp.body) as InvokeReturn<Stream, Output>;
  } else {
    const data = await resp.json();
    return (schema ? schema.parse(data) : data) as InvokeReturn<Stream, Output>;
  }
}
