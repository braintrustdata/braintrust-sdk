// Conditional imports for OpenTelemetry to handle missing dependencies gracefully
import { SpanComponentsV4 } from "../util/span_identifier_v4";
import { SpanObjectTypeV3 } from "../util/span_identifier_v3";

interface OtelContext {
  getValue?: (key: string) => unknown;
}

interface OtelSpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: unknown;
}

interface OtelApi {
  context: {
    active: () => OtelContext;
  };
  trace: {
    getSpan: (ctx: OtelContext) => unknown;
    getSpanContext: (ctx: OtelContext) => OtelSpanContext | undefined;
    setSpan: (ctx: OtelContext, span: unknown) => OtelContext;
    wrapSpanContext: (spanContext: unknown) => unknown;
  };
  TraceFlags?: {
    SAMPLED: number;
  };
}

let otelApi: OtelApi | null = null;
let otelSdk: {
  BatchSpanProcessor: new (exporter: unknown) => SpanProcessor;
} | null = null;
let OTEL_AVAILABLE = false;

try {
  otelApi = require("@opentelemetry/api");
  otelSdk = require("@opentelemetry/sdk-trace-base");
  OTEL_AVAILABLE = true;
} catch {
  console.warn(
    "OpenTelemetry packages are not installed. " +
      "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions",
  );
  OTEL_AVAILABLE = false;
}

// Type definitions that don't depend on OpenTelemetry being installed
interface Context {
  getValue?: (key: string) => unknown;
}

interface SpanProcessor {
  onStart(span: Span, parentContext?: Context): void;
  onEnd(span: ReadableSpan): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

interface ReadableSpan {
  name: string;
  parentSpanContext?: { spanId: string; traceId: string };
  attributes?: Record<string, any>;
  spanContext(): { spanId: string; traceId: string };
  parentSpanId?: string; // NOTE: In OTel JS v1.x, ReadableSpan exposed `parentSpanId?: string`
}

interface Span extends ReadableSpan {
  end(): void;
  setAttributes(attributes: Record<string, any>): void;
  setStatus(status: { code: number; message?: string }): void;
}

const FILTER_PREFIXES = [
  "gen_ai.",
  "braintrust.",
  "llm.",
  "ai.",
  "traceloop.",
] as const;

/**
 * Custom filter function type for span filtering.
 * @param span - The span to evaluate
 * @returns true to definitely keep, false to definitely drop, null/undefined to not influence the decision
 */
export type CustomSpanFilter = (
  span: ReadableSpan,
) => boolean | null | undefined;

/**
 * A span processor that filters spans to only export filtered telemetry.
 *
 * Only filtered spans and root spans will be forwarded to the inner processor.
 * This dramatically reduces telemetry volume while preserving important observability.
 *
 * @example
 * ```typescript
 * const processor = new AISpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()));
 * const provider = new TracerProvider();
 * provider.addSpanProcessor(processor);
 * ```
 */
export class AISpanProcessor {
  private static checkOtelAvailable(): void {
    if (!OTEL_AVAILABLE) {
      throw new Error(
        "OpenTelemetry packages are not installed. " +
          "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions",
      );
    }
  }
  private readonly processor: SpanProcessor;
  private readonly customFilter: CustomSpanFilter | undefined;

  /**
   * Initialize the filter span processor.
   *
   * @param processor - The wrapped span processor that will receive filtered spans
   * @param customFilter - Optional function that takes a span and returns:
   *                      true to keep, false to drop,
   *                      null/undefined to not influence the decision
   */
  constructor(processor: SpanProcessor, customFilter?: CustomSpanFilter) {
    AISpanProcessor.checkOtelAvailable();
    this.processor = processor;
    this.customFilter = customFilter;
  }

  /**
   * Forward span start events to the inner processor.
   */
  onStart(span: Span, parentContext: Context): void {
    this.processor.onStart(span, parentContext);
  }

  /**
   * Apply filtering logic and conditionally forward span end events.
   */
  onEnd(span: ReadableSpan): void {
    const shouldKeep = this.shouldKeepFilteredSpan(span);
    if (shouldKeep) {
      this.processor.onEnd(span);
    }
  }

  /**
   * Shutdown the inner processor.
   */
  shutdown(): Promise<void> {
    return this.processor.shutdown();
  }

  /**
   * Force flush the inner processor.
   */
  forceFlush(): Promise<void> {
    return this.processor.forceFlush();
  }

  /**
   * Determine if a span should be kept based on filtering criteria.
   *
   * Keep spans if:
   * 1. It's a root span (no parent)
   * 2. Custom filter returns true/false (if provided)
   * 3. Span name starts with 'gen_ai.', 'braintrust.', 'llm.', 'ai.', or 'traceloop.'
   * 4. Any attribute name starts with those prefixes
   */
  private shouldKeepFilteredSpan(span: ReadableSpan): boolean {
    if (!span) {
      return false;
    }

    // Always keep root spans (no parent). We check both parentSpanContext and parentSpanId to handle both OTel v1 and v2 child spans.
    if (!span.parentSpanContext && !span.parentSpanId) {
      return true;
    }

    // Apply custom filter if provided
    if (this.customFilter) {
      const customResult = this.customFilter(span);
      if (customResult === true) {
        return true;
      } else if (customResult === false) {
        return false;
      }
      // customResult is null/undefined - continue with default logic
    }

    // Check span name
    if (FILTER_PREFIXES.some((prefix) => span.name.startsWith(prefix))) {
      return true;
    }

    // Check attribute names
    const attributes = span.attributes;
    if (attributes) {
      const attributeNames = Object.keys(attributes);
      if (
        attributeNames.some((name) =>
          FILTER_PREFIXES.some((prefix) => name.startsWith(prefix)),
        )
      ) {
        return true;
      }
    }

    return false;
  }
}

interface BraintrustSpanProcessorOptions {
  /**
   * Braintrust API key. If not provided, will use BRAINTRUST_API_KEY environment variable.
   */
  apiKey?: string;
  /**
   * Braintrust API URL. If not provided, will use BRAINTRUST_API_URL environment variable. Defaults to https://api.braintrust.dev
   */
  apiUrl?: string;
  /**
   * Braintrust parent project name (e.g., "project_name:otel_examples"). If not provided, will use BRAINTRUST_PARENT environment variable.
   */
  parent?: string;
  /**
   * Whether to enable AI span filtering. Defaults to false.
   */
  filterAISpans?: boolean;
  /**
   * Custom filter function for span filtering
   */
  customFilter?: CustomSpanFilter;
  /**
   * Additional headers to send with telemetry data
   */
  headers?: Record<string, string>;
}

/**
 * A span processor that sends OpenTelemetry spans to Braintrust.
 *
 * This processor uses a BatchSpanProcessor and an OTLP exporter configured
 * to send data to Braintrust's telemetry endpoint. Span filtering is disabled
 * by default but can be enabled with the filterAISpans option.
 *
 * Environment Variables:
 * - BRAINTRUST_API_KEY: Your Braintrust API key
 * - BRAINTRUST_PARENT: Parent identifier (e.g., "project_name:test")
 * - BRAINTRUST_API_URL: Base URL for Braintrust API (defaults to https://api.braintrust.dev)
 *
 * @example
 * ```typescript
 * const processor = new BraintrustSpanProcessor({
 *   apiKey: 'your-api-key',
 *   apiUrl: 'https://api.braintrust.dev'
 * });
 * const provider = new TracerProvider();
 * provider.addSpanProcessor(processor);
 * ```
 *
 * @example With span filtering enabled:
 * ```typescript
 * const processor = new BraintrustSpanProcessor({
 *   apiKey: 'your-api-key',
 *   filterAISpans: true
 * });
 * ```
 *
 * @example Using environment variables:
 * ```typescript
 * // Set environment variables:
 * // BRAINTRUST_API_KEY=your-api-key
 * // BRAINTRUST_PARENT=project_name:test
 * // BRAINTRUST_API_URL=https://api.braintrust.dev
 * const processor = new BraintrustSpanProcessor();
 * ```
 */
export class BraintrustSpanProcessor {
  private static checkOtelAvailable(): void {
    if (!OTEL_AVAILABLE) {
      throw new Error(
        "OpenTelemetry packages are not installed. " +
          "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions",
      );
    }
  }
  private readonly processor: SpanProcessor;
  private readonly aiSpanProcessor: SpanProcessor;

  constructor(options: BraintrustSpanProcessorOptions = {}) {
    BraintrustSpanProcessor.checkOtelAvailable();

    // Get API key from options or environment
    const apiKey = options.apiKey || process.env.BRAINTRUST_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Braintrust API key is required. Set BRAINTRUST_API_KEY environment variable or pass apiKey option.",
      );
    }

    // Get API URL from options or environment
    let apiUrl =
      options.apiUrl ||
      process.env.BRAINTRUST_API_URL ||
      "https://api.braintrust.dev";

    // Ensure apiUrl ends with / for proper joining
    if (!apiUrl.endsWith("/")) {
      apiUrl += "/";
    }

    // Get parent from options or environment
    let parent = options.parent || process.env.BRAINTRUST_PARENT;

    // Default parent if not provided
    if (!parent) {
      parent = "project_name:default-otel-project";
      console.info(
        `No parent specified, using default: ${parent}. ` +
          "Configure with BRAINTRUST_PARENT environment variable or parent parameter.",
      );
    }

    // Create OTLP exporter
    let exporter: unknown;
    try {
      const {
        OTLPTraceExporter,
      } = require("@opentelemetry/exporter-trace-otlp-http");

      const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-bt-parent": parent,
        ...options.headers,
      };

      const baseExporter = new OTLPTraceExporter({
        url: new URL("otel/v1/traces", apiUrl).href,
        headers,
      });

      interface RawSpan {
        instrumentationScope?: unknown;
        instrumentationLibrary?: unknown;
        parentSpanContext?: unknown;
        parentSpanId?: string;
        spanContext?: () => { traceId: string };
      }

      exporter = new Proxy(baseExporter, {
        get(target, prop, receiver) {
          // If the code is trying to access the 'export' method, return our patched version.
          if (prop === "export") {
            return function (
              spans: RawSpan[],
              resultCallback: (result: unknown) => void,
            ) {
              // This patch handles OTel version mismatches
              const fixedSpans = spans.map((span: RawSpan) => {
                if (!span.instrumentationScope && span.instrumentationLibrary) {
                  span.instrumentationScope = span.instrumentationLibrary;
                }

                if (!span.parentSpanContext && span.parentSpanId) {
                  const spanContext = span.spanContext?.();
                  if (spanContext?.traceId) {
                    span.parentSpanContext = {
                      spanId: span.parentSpanId,
                      traceId: spanContext.traceId,
                    };
                  }
                }

                return span;
              });

              // Call the original export method with the fixed spans.
              return Reflect.apply(
                (target as { export: unknown }).export as (
                  ...args: unknown[]
                ) => unknown,
                target,
                [fixedSpans, resultCallback],
              );
            };
          }

          // For any other property, pass the access through to the original object.
          return Reflect.get(target, prop, receiver);
        },
      });
    } catch (error) {
      console.error(error);
      throw new Error(
        "Failed to create OTLP exporter. Make sure @opentelemetry/exporter-trace-otlp-http is installed.",
      );
    }

    // Create batch processor with the exporter
    if (!otelSdk) {
      throw new Error("OpenTelemetry SDK not available");
    }
    this.processor = new otelSdk.BatchSpanProcessor(exporter);

    // Conditionally wrap with filtering based on filterAISpans flag
    if (options.filterAISpans === true) {
      // Only enable filtering if explicitly requested
      this.aiSpanProcessor = new AISpanProcessor(
        this.processor,
        options.customFilter,
      );
    } else {
      // Use the batch processor directly without filtering (default behavior)
      this.aiSpanProcessor = this.processor;
    }
  }

  onStart(span: Span, parentContext: Context): void {
    try {
      let parentValue: string | undefined;

      // Priority 1: Check if braintrust.parent is in current OTEL context
      if (otelApi && otelApi.context) {
        const currentContext = otelApi.context.active();
        const contextValue = currentContext.getValue?.("braintrust.parent");
        if (typeof contextValue === "string") {
          parentValue = contextValue;
        }

        // Priority 2: Check if parent_context has braintrust.parent (backup)
        if (!parentValue && parentContext) {
          const parentContextValue =
            typeof parentContext.getValue === "function"
              ? parentContext.getValue("braintrust.parent")
              : undefined;
          if (typeof parentContextValue === "string") {
            parentValue = parentContextValue;
          }
        }

        // Priority 3: Check if parent OTEL span has braintrust.parent attribute
        if (!parentValue && parentContext) {
          parentValue = this._getParentOtelBraintrustParent(parentContext);
        }

        // Set the attribute if we found a parent value
        if (parentValue && typeof span.setAttributes === "function") {
          span.setAttributes({ "braintrust.parent": parentValue });
        }
      }
    } catch {
      // If there's an exception, just don't set braintrust.parent
    }

    this.aiSpanProcessor.onStart(span, parentContext);
  }

  private _getParentOtelBraintrustParent(
    parentContext: Context,
  ): string | undefined {
    try {
      if (!otelApi || !otelApi.trace) {
        return undefined;
      }

      const currentSpan =
        typeof otelApi.trace.getSpan === "function"
          ? otelApi.trace.getSpan(parentContext)
          : undefined;

      if (
        currentSpan &&
        typeof currentSpan === "object" &&
        "attributes" in currentSpan &&
        typeof currentSpan.attributes === "object"
      ) {
        const attributes = currentSpan.attributes as Record<string, unknown>;
        const parentAttr = attributes["braintrust.parent"];
        return typeof parentAttr === "string" ? parentAttr : undefined;
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  onEnd(span: ReadableSpan): void {
    this.aiSpanProcessor.onEnd(span);
  }

  shutdown(): Promise<void> {
    return this.aiSpanProcessor.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.aiSpanProcessor.forceFlush();
  }
}

/**
 * Create an OTEL context from a Braintrust span export string.
 *
 * Used for distributed tracing scenarios where a Braintrust span in one service
 * needs to be the parent of an OTEL span in another service.
 *
 * @param exportStr - The string returned from span.export()
 * @returns OTEL context that can be used when creating child spans
 *
 * @example
 * ```typescript
 * // Service A: Create BT span and export
 * const span = logger.startSpan({ name: "service-a" });
 * const exportStr = await span.export();
 * // Send exportStr to Service B (e.g., via HTTP header)
 *
 * // Service B: Import context and create OTEL child
 * import * as api from '@opentelemetry/api';
 * const ctx = otelContextFromSpanExport(exportStr);
 * await api.context.with(ctx, async () => {
 *   await tracer.startActiveSpan("service-b", async (span) => {
 *     // This span is now a child of the Service A span
 *     span.end();
 *   });
 * });
 * ```
 */
export function otelContextFromSpanExport(exportStr: string): unknown {
  if (!OTEL_AVAILABLE || !otelApi) {
    // Gracefully return undefined when OTEL is not installed
    // This allows code to work without OTEL dependencies
    return undefined;
  }

  // Parse the export string
  const components = SpanComponentsV4.fromStr(exportStr);

  // Get trace and span IDs (already in hex format)
  const traceIdHex = components.data.root_span_id; // 32 hex chars
  const spanIdHex = components.data.span_id; // 16 hex chars

  if (!traceIdHex || !spanIdHex) {
    throw new Error(
      "Export string must contain root_span_id and span_id for distributed tracing",
    );
  }

  // Import OTEL classes dynamically
  const otelTrace = otelApi.trace;

  // Create SpanContext marked as remote (critical for distributed tracing)
  const spanContext = {
    traceId: traceIdHex,
    spanId: spanIdHex,
    isRemote: true,
    traceFlags: otelApi.TraceFlags?.SAMPLED ?? 1, // SAMPLED flag
  };

  // Create NonRecordingSpan using wrapSpanContext and set in context
  const nonRecordingSpan = otelTrace.wrapSpanContext(spanContext);
  let ctx = otelTrace.setSpan(otelApi.context.active(), nonRecordingSpan);

  // Construct braintrust.parent identifier
  const braintrustParent = getBraintrustParent(
    components.data.object_type,
    components.data.object_id,
    components.data.compute_object_metadata_args,
  );

  // Set braintrust.parent in baggage so it propagates automatically
  if (braintrustParent) {
    try {
      // Try to set baggage if available
      const propagation = (otelApi as any).propagation;
      if (propagation) {
        const baggage =
          propagation.getBaggage(ctx) || propagation.createBaggage();
        ctx = propagation.setBaggage(
          ctx,
          baggage.setEntry("braintrust.parent", { value: braintrustParent }),
        );
      }
    } catch (error) {
      console.error(
        "Failed to set braintrust.parent in baggage during context import:",
        error,
      );
    }
  }

  return ctx;
}

/**
 * Construct a braintrust.parent identifier string from span components.
 *
 * @param objectType - Type of parent object (PROJECT_LOGS or EXPERIMENT)
 * @param objectId - Resolved object ID (project_id or experiment_id)
 * @param computeArgs - Optional dict with project_name/project_id for unresolved cases
 * @returns String like "project_id:abc", "project_name:my-proj", "experiment_id:exp-123", or undefined
 */
export function getBraintrustParent(
  objectType: number,
  objectId?: string | null,
  computeArgs?: Record<string, unknown> | null,
): string | undefined {
  if (!objectType) {
    return undefined;
  }

  if (objectType === SpanObjectTypeV3.PROJECT_LOGS) {
    if (objectId) {
      return `project_id:${objectId}`;
    } else if (computeArgs) {
      const projectId = computeArgs["project_id"];
      const projectName = computeArgs["project_name"];
      if (typeof projectId === "string") {
        return `project_id:${projectId}`;
      } else if (typeof projectName === "string") {
        return `project_name:${projectName}`;
      }
    }
  } else if (objectType === SpanObjectTypeV3.EXPERIMENT) {
    if (objectId) {
      return `experiment_id:${objectId}`;
    } else if (computeArgs) {
      const experimentId = computeArgs["experiment_id"];
      if (typeof experimentId === "string") {
        return `experiment_id:${experimentId}`;
      }
    }
  }

  return undefined;
}

/**
 * A trace exporter that sends OpenTelemetry spans to Braintrust.
 *
 * This exporter wraps the standard OTLP trace exporter and can be used with
 * any OpenTelemetry setup, including @vercel/otel's registerOTel function,
 * NodeSDK, or custom tracer providers. It can optionally filter spans to
 * only send AI-related telemetry.
 *
 * Environment Variables:
 * - BRAINTRUST_API_KEY: Your Braintrust API key
 * - BRAINTRUST_PARENT: Parent identifier (e.g., "project_name:test")
 * - BRAINTRUST_API_URL: Base URL for Braintrust API (defaults to https://api.braintrust.dev)
 *
 * @example With @vercel/otel:
 * ```typescript
 * import { registerOTel } from '@vercel/otel';
 * import { BraintrustExporter } from 'braintrust';
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
 * @example With NodeSDK:
 * ```typescript
 * import { NodeSDK } from '@opentelemetry/sdk-node';
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
 * import { BraintrustExporter } from 'braintrust';
 *
 * const sdk = new NodeSDK({
 *   spanProcessors: [
 *     new BatchSpanProcessor(new BraintrustExporter({
 *       apiKey: 'your-api-key',
 *       parent: 'project_name:test'
 *     }))
 *   ]
 * });
 * ```
 */
export class BraintrustExporter {
  private static checkOtelAvailable(): void {
    if (!OTEL_AVAILABLE) {
      throw new Error(
        "OpenTelemetry packages are not installed. " +
          "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions",
      );
    }
  }

  private readonly processor: BraintrustSpanProcessor;
  private readonly spans: ReadableSpan[] = [];
  private readonly callbacks: Array<(result: any) => void> = [];

  constructor(options: BraintrustSpanProcessorOptions = {}) {
    BraintrustExporter.checkOtelAvailable();

    // Use BraintrustSpanProcessor under the hood
    this.processor = new BraintrustSpanProcessor(options);
  }

  /**
   * Export spans to Braintrust by simulating span processor behavior.
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: { code: number; error?: unknown }) => void,
  ): void {
    try {
      // Process each span through the processor
      spans.forEach((span) => {
        this.processor.onEnd(span);
      });

      // Force flush to ensure spans are sent
      this.processor
        .forceFlush()
        .then(() => {
          resultCallback({ code: 0 }); // SUCCESS
        })
        .catch((error) => {
          resultCallback({ code: 1, error }); // FAILURE
        });
    } catch (error) {
      resultCallback({ code: 1, error }); // FAILURE
    }
  }

  /**
   * Shutdown the exporter.
   */
  shutdown(): Promise<void> {
    return this.processor.shutdown();
  }

  /**
   * Force flush the exporter.
   */
  forceFlush(): Promise<void> {
    return this.processor.forceFlush();
  }
}

/**
 * Add braintrust.parent to OTEL baggage.
 *
 * This ensures that when using propagation inject() for distributed tracing,
 * the braintrust.parent will be propagated via baggage to downstream services.
 *
 * @param parent - Braintrust parent identifier (e.g., "project_name:my-project",
 *                 "project_id:abc123", "experiment_id:exp-456")
 * @param ctx - Optional OTEL context to use. If not provided, uses current context.
 * @returns Updated context with braintrust.parent in baggage
 *
 * @example
 * ```typescript
 * import { otel } from "braintrust";
 * import { propagation } from "@opentelemetry/api";
 *
 * // Set braintrust.parent in baggage
 * otel.addParentToBaggage("project_name:my-project");
 *
 * // Export headers (will include braintrust.parent in baggage)
 * const headers = {};
 * propagation.inject(context.active(), headers);
 * ```
 */
function addParentToBaggage(parent: string, ctx?: Context): Context {
  if (!OTEL_AVAILABLE || !otelApi) {
    console.error("OpenTelemetry not available");
    return (ctx || otelApi?.context.active()) as Context;
  }

  try {
    const propagation = (otelApi as any).propagation;
    if (!propagation) {
      console.error("OTEL propagation API not available");
      return (ctx || otelApi.context.active()) as Context;
    }

    const currentCtx = ctx || otelApi.context.active();
    const baggage =
      propagation.getBaggage(currentCtx) || propagation.createBaggage();
    return propagation.setBaggage(
      currentCtx,
      baggage.setEntry("braintrust.parent", { value: parent }),
    );
  } catch (error) {
    console.error("Failed to add braintrust.parent to baggage:", error);
    return (ctx || otelApi.context.active()) as Context;
  }
}

/**
 * Copy braintrust.parent from span attribute to OTEL baggage.
 *
 * BraintrustSpanProcessor automatically sets braintrust.parent as a span attribute
 * when OTEL spans are created within Braintrust contexts. This function copies that
 * attribute to OTEL baggage so it propagates when using inject() for distributed tracing.
 *
 * @param span - OTEL span that has braintrust.parent attribute set
 * @param ctx - Optional OTEL context to use. If not provided, uses current context.
 * @returns Updated context with braintrust.parent in baggage, or undefined if attribute not found
 *
 * @example
 * ```typescript
 * import { otel } from "braintrust";
 * import { propagation } from "@opentelemetry/api";
 *
 * tracer.startActiveSpan("service_b", (span) => {
 *   // Copy braintrust.parent from span attribute to baggage
 *   otel.addSpanParentToBaggage(span);
 *
 *   // Export headers (will include braintrust.parent in baggage)
 *   const headers = {};
 *   propagation.inject(context.active(), headers);
 *   span.end();
 * });
 * ```
 */
function addSpanParentToBaggage(
  span: Span,
  ctx?: Context,
): Context | undefined {
  if (!span || !span.attributes) {
    console.warn("addSpanParentToBaggage: span has no attributes");
    return undefined;
  }

  const parentValue = span.attributes["braintrust.parent"];
  if (!parentValue || typeof parentValue !== "string") {
    console.warn(
      "addSpanParentToBaggage: braintrust.parent attribute not found. " +
        "Ensure BraintrustSpanProcessor is configured or span is created within Braintrust context.",
    );
    return undefined;
  }

  return addParentToBaggage(parentValue, ctx);
}

/**
 * Extract a Braintrust-compatible parent string from W3C Trace Context headers.
 *
 * This converts OTEL trace context headers (traceparent/baggage) into a format
 * that can be passed as the 'parent' parameter to Braintrust's traced() method.
 *
 * @param headers - Dictionary with 'traceparent' and optionally 'baggage' keys
 * @returns Braintrust V4 export string that can be used as parent parameter,
 *          or undefined if no valid span context is found or braintrust.parent is missing.
 *
 * @example
 * ```typescript
 * import { otel, initLogger } from "braintrust";
 *
 * // Service C receives headers from Service B
 * const headers = { traceparent: '00-trace_id-span_id-01', baggage: '...' };
 * const parent = otel.parentFromHeaders(headers);
 *
 * const logger = initLogger({ projectName: "my-project" });
 * await logger.traced(async (span) => {
 *   span.log({ input: "BT span as child of OTEL parent" });
 * }, { name: "service_c", parent });
 * ```
 */
function parentFromHeaders(
  headers: Record<string, string>,
): string | undefined {
  if (!OTEL_AVAILABLE || !otelApi) {
    console.error("OpenTelemetry not available");
    return undefined;
  }

  try {
    const propagation = (otelApi as any).propagation;
    if (!propagation) {
      console.error("OTEL propagation API not available");
      return undefined;
    }

    // Extract context from headers using W3C Trace Context propagator
    // This parses both traceparent and baggage headers
    const ctx = propagation.extract(otelApi.context.active(), headers);

    // Get span context directly from the extracted context
    const spanContext = otelApi.trace.getSpanContext(ctx);
    if (!spanContext) {
      console.error("parentFromHeaders: No valid span context in headers");
      return undefined;
    }

    // Get trace_id and span_id from span context
    const traceIdHex = spanContext.traceId as string;
    const spanIdHex = spanContext.spanId as string;

    // Validate trace_id and span_id are not all zeros
    if (
      !traceIdHex ||
      typeof traceIdHex !== "string" ||
      traceIdHex === "00000000000000000000000000000000"
    ) {
      console.error("parentFromHeaders: Invalid trace_id (all zeros)");
      return undefined;
    }
    if (
      !spanIdHex ||
      typeof spanIdHex !== "string" ||
      spanIdHex === "0000000000000000"
    ) {
      console.error("parentFromHeaders: Invalid span_id (all zeros)");
      return undefined;
    }

    // Get braintrust.parent from baggage
    const baggage = propagation.getBaggage(ctx);
    const braintrustParent = baggage?.getEntry("braintrust.parent")?.value;

    if (!braintrustParent) {
      console.warn(
        "parentFromHeaders: braintrust.parent not found in OTEL baggage. " +
          "Cannot create Braintrust parent without project information. " +
          "Ensure the OTEL span sets braintrust.parent in baggage before exporting headers.",
      );
      return undefined;
    }

    // Parse braintrust.parent to extract object_type and object_id
    let objectType: number | undefined;
    let objectId: string | undefined;
    let computeArgs: Record<string, unknown> | undefined;

    // Parse braintrust.parent format: "project_id:abc", "project_name:xyz", or "experiment_id:123"
    if (braintrustParent.startsWith("project_id:")) {
      objectType = SpanObjectTypeV3.PROJECT_LOGS;
      objectId = braintrustParent.substring("project_id:".length);
      if (!objectId) {
        console.error(
          `parentFromHeaders: Invalid braintrust.parent format (empty project_id): ${braintrustParent}`,
        );
        return undefined;
      }
    } else if (braintrustParent.startsWith("project_name:")) {
      objectType = SpanObjectTypeV3.PROJECT_LOGS;
      const projectName = braintrustParent.substring("project_name:".length);
      if (!projectName) {
        console.error(
          `parentFromHeaders: Invalid braintrust.parent format (empty project_name): ${braintrustParent}`,
        );
        return undefined;
      }
      computeArgs = { project_name: projectName };
    } else if (braintrustParent.startsWith("experiment_id:")) {
      objectType = SpanObjectTypeV3.EXPERIMENT;
      objectId = braintrustParent.substring("experiment_id:".length);
      if (!objectId) {
        console.error(
          `parentFromHeaders: Invalid braintrust.parent format (empty experiment_id): ${braintrustParent}`,
        );
        return undefined;
      }
    } else {
      console.error(
        `parentFromHeaders: Invalid braintrust.parent format: ${braintrustParent}. ` +
          "Expected format: 'project_id:ID', 'project_name:NAME', or 'experiment_id:ID'",
      );
      return undefined;
    }

    // Create SpanComponentsV4 and export as string
    const componentsData: {
      object_type: number;
      object_id?: string | null;
      compute_object_metadata_args?: Record<string, unknown> | null;
      row_id: string;
      span_id: string;
      root_span_id: string;
    } = {
      object_type: objectType,
      row_id: "otel", // Dummy row_id to enable span_id/root_span_id fields
      span_id: spanIdHex,
      root_span_id: traceIdHex,
    };

    // Add either object_id or compute_object_metadata_args, not both
    if (computeArgs) {
      componentsData.compute_object_metadata_args = computeArgs;
    } else {
      componentsData.object_id = objectId;
    }

    const components = new SpanComponentsV4(componentsData as any);

    return components.toStr();
  } catch (error) {
    console.error("parentFromHeaders: Error parsing headers:", error);
    return undefined;
  }
}

/**
 * OTEL namespace containing distributed tracing helper functions.
 *
 * @example
 * ```typescript
 * import { otel } from "braintrust";
 *
 * // Export Braintrust span context for OTEL
 * const ctx = otel.contextFromSpanExport(exportStr);
 *
 * // Add parent to baggage before propagating
 * otel.addParentToBaggage("project_name:my-project");
 *
 * // Copy span attribute to baggage
 * otel.addSpanParentToBaggage(span);
 *
 * // Create Braintrust parent from OTEL headers
 * const parent = otel.parentFromHeaders(headers);
 * ```
 */
export const otel = {
  contextFromSpanExport: otelContextFromSpanExport,
  getBraintrustParent,
  addParentToBaggage,
  addSpanParentToBaggage,
  parentFromHeaders,
};
