/**
 * OpenTelemetry integration for Braintrust SDK.
 *
 * This package provides span processors, exporters, and utilities for integrating
 * Braintrust with OpenTelemetry instrumentation.
 *
 * @example Basic usage with NodeSDK:
 * ```typescript
 * import { NodeSDK } from '@opentelemetry/sdk-node';
 * import { BraintrustSpanProcessor } from '@braintrust/otel';
 *
 * const sdk = new NodeSDK({
 *   spanProcessors: [
 *     new BraintrustSpanProcessor({
 *       parent: 'project_name:my-project',
 *     }),
 *   ],
 * });
 *
 * sdk.start();
 * ```
 *
 * @example With Vercel OTEL:
 * ```typescript
 * import { registerOTel } from '@vercel/otel';
 * import { BraintrustExporter } from '@braintrust/otel';
 *
 * export function register() {
 *   registerOTel({
 *     serviceName: 'my-app',
 *     traceExporter: new BraintrustExporter({
 *       filterAISpans: true,
 *     }),
 *   });
 * }
 * ```
 *
 * @module @braintrust/otel
 */

// Export types that Braintrust SDK can implement
export type {
  ContextParentSpanIds,
  Span,
  SpanComponentsV4Data,
  SpanComponentsV4Constructor,
} from "./types";
export { ContextManager, SpanObjectTypeV3, SpanComponentsV4 } from "./types";

// Export OTEL integration classes
export {
  AISpanProcessor,
  BraintrustSpanProcessor,
  CustomSpanFilter,
  BraintrustSpanProcessorOptions,
} from "./processors";
export { BraintrustExporter } from "./exporter";
export { OtelContextManager, BRAINTRUST_SPAN_KEY, BRAINTRUST_PARENT_KEY } from "./context";
export {
  otelContextFromSpanExport,
  getBraintrustParent,
  addParentToBaggage,
  addSpanParentToBaggage,
  parentFromHeaders,
} from "./utils";

// Export otel namespace for compatibility
import * as utils from "./utils";
export const otel = {
  contextFromSpanExport: utils.otelContextFromSpanExport,
  getBraintrustParent: utils.getBraintrustParent,
  addParentToBaggage: utils.addParentToBaggage,
  addSpanParentToBaggage: utils.addSpanParentToBaggage,
  parentFromHeaders: utils.parentFromHeaders,
};

