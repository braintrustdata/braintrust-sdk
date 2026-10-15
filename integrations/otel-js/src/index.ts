import { OtelContextManager } from "./context";
import { configureContextManager } from "braintrust";

export {
  contextFromSpan,
  addSpanParentToBaggage,
  addParentToBaggage,
  parentFromHeaders,
  isRootSpan,
} from "./otel";

export { BraintrustSpanProcessor, BraintrustExporter } from "./otel";

export const setupOtelCompat = (): void => {
  // Read braintrust's shared registration directly so this works with any
  // supported braintrust version. Keep the message in sync with braintrust.
  const spanCustomizers: unknown = (globalThis as Record<symbol, unknown>)[
    Symbol.for("braintrust.spanCustomizers")
  ];
  if (Array.isArray(spanCustomizers) && spanCustomizers.length) {
    // eslint-disable-next-line no-restricted-properties -- intentional always-visible configuration error.
    console.error(
      "Braintrust span customizers are not supported with OpenTelemetry compat mode yet.",
    );
  }
  configureContextManager(OtelContextManager);
};

export const resetOtelCompat = (): void => {
  configureContextManager(undefined);
};
