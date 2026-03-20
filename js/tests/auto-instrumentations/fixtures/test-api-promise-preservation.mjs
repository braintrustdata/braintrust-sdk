import { tracingChannel } from "node:diagnostics_channel";
import { parentPort } from "node:worker_threads";

class HelperPromise extends Promise {
  async withResponse() {
    return {
      data: await this,
      response: { ok: true },
    };
  }
}

const channel = tracingChannel("braintrust:test:helper-promise");
const traced = channel.tracePromise(
  () => new HelperPromise((resolve) => resolve("ok")),
  {},
);

const withResponse = await traced.withResponse();

parentPort?.postMessage({
  type: "helper-result",
  result: {
    awaitedValue: await traced,
    constructorName: traced.constructor.name,
    hasWithResponse: typeof traced.withResponse === "function",
    withResponseData: withResponse.data,
    withResponseOk: withResponse.response.ok,
  },
});
