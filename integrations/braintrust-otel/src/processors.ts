// OpenTelemetry span processors for Braintrust
import * as api from "@opentelemetry/api";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// Create context key for braintrust.parent
const BRAINTRUST_PARENT_KEY = api.createContextKey("braintrust.parent");

// Type definitions
interface SpanProcessor {
  onStart(span: Span, parentContext: api.Context): void;
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
 * import { AISpanProcessor } from '@braintrust/otel';
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 *
 * const processor = new AISpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()));
 * const provider = new TracerProvider();
 * provider.addSpanProcessor(processor);
 * ```
 */
export class AISpanProcessor {
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
    this.processor = processor;
    this.customFilter = customFilter;
  }

  /**
   * Forward span start events to the inner processor.
   */
  onStart(span: Span, parentContext: api.Context): void {
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

export interface BraintrustSpanProcessorOptions {
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
 * import { BraintrustSpanProcessor } from '@braintrust/otel';
 * import { TracerProvider } from '@opentelemetry/sdk-trace-base';
 *
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
  private readonly processor: SpanProcessor;
  private readonly aiSpanProcessor: SpanProcessor;

  constructor(options: BraintrustSpanProcessorOptions = {}) {
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

    // Wrap exporter with proxy to handle OTel version mismatches
    const exporter = new Proxy(baseExporter, {
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

    // Create batch processor with the exporter
    this.processor = new BatchSpanProcessor(exporter);

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

  onStart(span: Span, parentContext: api.Context): void {
    try {
      let parentValue: string | undefined;

      // Priority 1: Check if braintrust.parent is in current OTEL context
      const currentContext = api.context.active();
      const contextValue = currentContext.getValue(BRAINTRUST_PARENT_KEY);
      if (typeof contextValue === "string") {
        parentValue = contextValue;
      }

      // Priority 2: Check if parent_context has braintrust.parent (backup)
      if (!parentValue) {
        const parentContextValue = parentContext.getValue(BRAINTRUST_PARENT_KEY);
        if (typeof parentContextValue === "string") {
          parentValue = parentContextValue;
        }
      }

      // Priority 3: Check if parent OTEL span has braintrust.parent attribute
      if (!parentValue) {
        parentValue = this._getParentOtelBraintrustParent(parentContext);
      }

      // Set the attribute if we found a parent value
      if (parentValue && typeof span.setAttributes === "function") {
        span.setAttributes({ "braintrust.parent": parentValue });
      }
    } catch {
      // If there's an exception, just don't set braintrust.parent
    }

    this.aiSpanProcessor.onStart(span, parentContext);
  }

  private _getParentOtelBraintrustParent(
    parentContext: api.Context,
  ): string | undefined {
    try {
      const currentSpan =
        typeof api.trace.getSpan === "function"
          ? api.trace.getSpan(parentContext)
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

