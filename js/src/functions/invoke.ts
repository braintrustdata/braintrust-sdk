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

export type InvokeFunctionArgs<Streaming extends boolean> = FunctionId &
  FullLoginOptions & {
    arg: unknown;
    parent?: Exportable | string;
    state?: BraintrustState;
    stream?: Streaming;
  };

export async function callFunction<Streaming extends boolean>({
  orgName,
  apiKey,
  appUrl,
  forceLogin,
  fetch,
  arg,
  parent: parentArg,
  state: stateArg,
  stream,
  ...functionId
}: InvokeFunctionArgs<Streaming>): Promise<
  Streaming extends true ? BraintrustStream : unknown
> {
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

  const callFunctionRequest: InvokeFunctionRequest = {
    ...functionId,
    arg,
    parent,
    stream,
    api_version: INVOKE_API_VERSION,
  };

  const resp = await state
    .proxyConn()
    .post(`function/invoke`, callFunctionRequest, {
      headers: {
        Accept: stream ? "text/event-stream" : "application/json",
      },
    });

  if (stream) {
    if (!resp.body) {
      throw new Error("Received empty stream body");
    }
    return new BraintrustStream(resp.body) as Streaming extends true
      ? BraintrustStream
      : never;
  } else {
    return (await resp.json()) as Streaming extends true ? never : unknown;
  }
}
