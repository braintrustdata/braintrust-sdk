import * as _ from "braintrust";
import type { ContextManager } from "braintrust";

import { OtelContextManager } from "./context";

export {
  contextFromSpanExport,
  addSpanParentToBaggage,
  addParentToBaggage,
  parentFromHeaders,
} from "./otel";

declare global {
  // eslint-disable-next-line no-var
  var BRAINTRUST_CONTEXT_MANAGER: (new () => ContextManager) | undefined;
}

export const setup = () => {
  globalThis.BRAINTRUST_CONTEXT_MANAGER = OtelContextManager;
};

setup();
