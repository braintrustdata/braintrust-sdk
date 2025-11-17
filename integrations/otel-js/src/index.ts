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

export const initOtel = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).globalThis.BRAINTRUST_CONTEXT_MANAGER =
    OtelContextManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).globalThis.BRAINTRUST_ID_GENERATOR = OTELIDGenerator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).BRAINTRUST_SPAN_COMPONENT = SpanComponentsV4;
};

export const resetOtel = () => {
  globalThis.BRAINTRUST_CONTEXT_MANAGER = undefined;
  globalThis.BRAINTRUST_ID_GENERATOR = undefined;
  globalThis.BRAINTRUST_SPAN_COMPONENT = undefined;
};
