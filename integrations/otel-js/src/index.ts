import * as _ from "braintrust";
import type { ContextManager, IDGenerator } from "braintrust";

import { OtelContextManager } from "./context";

export {
  contextFromSpanExport,
  addSpanParentToBaggage,
  addParentToBaggage,
  parentFromHeaders,
} from "./otel";

import { OTELIDGenerator } from "./otel";
import { SpanComponentsV4 } from "braintrust/util";

export { BraintrustSpanProcessor } from "./otel";

declare global {
  // eslint-disable-next-line no-var
  var BRAINTRUST_CONTEXT_MANAGER: (new () => ContextManager) | undefined;
  var BRAINTRUST_ID_GENERATOR: (new () => IDGenerator) | undefined;
  var BRAINTRUST_SPAN_COMPONENT: typeof SpanComponentsV4 | undefined;
}

export const initOtel = () => {
  globalThis.BRAINTRUST_CONTEXT_MANAGER = OtelContextManager;
  globalThis.BRAINTRUST_ID_GENERATOR = OTELIDGenerator;
  globalThis.BRAINTRUST_SPAN_COMPONENT = SpanComponentsV4;
};

export const resetOtel = () => {
  globalThis.BRAINTRUST_CONTEXT_MANAGER = undefined;
  globalThis.BRAINTRUST_ID_GENERATOR = undefined;
  globalThis.BRAINTRUST_SPAN_COMPONENT = undefined;
};
