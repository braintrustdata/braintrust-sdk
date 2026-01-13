import { OtelContextManager } from "./context";

export {
  contextFromSpanExport,
  addSpanParentToBaggage,
  addParentToBaggage,
  parentFromHeaders,
  isRootSpan,
} from "./otel";

import { OTELIDGenerator } from "./otel";
import { SpanComponentsV4 } from "braintrust/util";

export { BraintrustSpanProcessor, BraintrustExporter } from "./otel";

export const setupOtelCompat = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).BRAINTRUST_CONTEXT_MANAGER = OtelContextManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).BRAINTRUST_ID_GENERATOR = OTELIDGenerator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).BRAINTRUST_SPAN_COMPONENT = SpanComponentsV4;
};

export const resetOtelCompat = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).BRAINTRUST_CONTEXT_MANAGER = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).BRAINTRUST_ID_GENERATOR = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
  (globalThis as any).BRAINTRUST_SPAN_COMPONENT = undefined;
};
