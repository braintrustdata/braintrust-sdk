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

export type FunctionReturnType<R, S extends boolean> = S extends true
  ? BraintrustStream
  : R;

export type InvokeFunctionArgs<T, R, S extends boolean = false> = FunctionId &
  FullLoginOptions & {
    arg: T;
    parent?: Exportable | string;
    state?: BraintrustState;
    stream?: S;
    returnSchema?: z.ZodType<R>;
  };

export async function invoke<T, R = unknown, S extends boolean = false>({
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
}: InvokeFunctionArgs<T, R, S>): Promise<FunctionReturnType<R, S>> {
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
    return new BraintrustStream(resp.body) as FunctionReturnType<R, S>;
  } else {
    const data = await resp.json();
    if (returnSchema) {
      return returnSchema.parse(data) as FunctionReturnType<R, S>;
    }
    return data as FunctionReturnType<R, S>;
  }
}
