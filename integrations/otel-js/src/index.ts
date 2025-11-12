import * as _ from "braintrust";
import type { ContextManager } from "braintrust";

import { OtelContextManager } from "./context";

export {
  contextFromSpanExport,
  addSpanParentToBaggage,
  addParentToBaggage,
  parentFromHeaders,
} from "./compat";

export { BraintrustExporter } from "./exporter";
export { BraintrustSpanProcessor } from "./processor";

declare global {
  var BRAINTRUST_CONTEXT_MANAGER: (new () => ContextManager) | undefined;
}

export const setup = () => {
  globalThis.BRAINTRUST_CONTEXT_MANAGER = OtelContextManager;
};

setup();
