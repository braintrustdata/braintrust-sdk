// Type definitions that don't depend on OpenTelemetry being installed
interface Context {
  [key: string]: unknown;
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
  attributes?: Record<string, unknown>;
  spanContext(): { spanId: string; traceId: string };
}

interface Span extends ReadableSpan {
  end(): void;
  setAttributes(attributes: Record<string, unknown>): void;
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

    // Always keep root spans (no parent)
    if (!span.parentSpanContext) {
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

// Cache for loaded OpenTelemetry modules
let otelModulesCache: {
  OTLPTraceExporter?: any;
  BatchSpanProcessor?: any;
  loaded?: boolean;
  error?: Error;
} = {};

/**
 * Dynamically load OpenTelemetry dependencies
 */
async function loadOtelDependencies() {
  if (otelModulesCache.loaded) {
    return otelModulesCache;
  }

  if (otelModulesCache.error) {
    throw otelModulesCache.error;
  }

  try {
    const [exporterModule, traceModule] = await Promise.all([
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/sdk-trace-base"),
    ]);

    otelModulesCache = {
      OTLPTraceExporter: exporterModule.OTLPTraceExporter,
      BatchSpanProcessor: traceModule.BatchSpanProcessor,
      loaded: true,
    };

    return otelModulesCache;
  } catch (error) {
    const err = new Error(
      "OpenTelemetry dependencies are not installed. Please install @opentelemetry/exporter-trace-otlp-http and @opentelemetry/sdk-trace-base to use BraintrustSpanProcessor.",
    );
    otelModulesCache.error = err;
    throw err;
  }
}

/**
 * A span processor that sends OpenTelemetry spans to Braintrust.
 *
 * This processor uses a BatchSpanProcessor and an OTLP exporter configured
 * to send data to Braintrust's telemetry endpoint. Span filtering is disabled
 * by default but can be enabled with the filterAISpans option.
 *
 * Note: This class requires @opentelemetry/exporter-trace-otlp-http and
 * @opentelemetry/sdk-trace-base to be installed as peer dependencies.
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
  private processor?: SpanProcessor;
  private aiSpanProcessor?: SpanProcessor;
  private initPromise?: Promise<void>;
  private options: BraintrustSpanProcessorOptions;

  constructor(options: BraintrustSpanProcessorOptions = {}) {
    this.options = options;
    // Start initialization but don't wait for it
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    // Get API key from options or environment
    const apiKey = this.options.apiKey || process.env.BRAINTRUST_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Braintrust API key is required. Set BRAINTRUST_API_KEY environment variable or pass apiKey option.",
      );
    }

    // Get API URL from options or environment
    let apiUrl =
      this.options.apiUrl ||
      process.env.BRAINTRUST_API_URL ||
      "https://api.braintrust.dev";

    // Ensure apiUrl ends with / for proper joining
    if (!apiUrl.endsWith("/")) {
      apiUrl += "/";
    }

    // Get parent from options or environment
    let parent = this.options.parent || process.env.BRAINTRUST_PARENT;

    // Default parent if not provided
    if (!parent) {
      parent = "project_name:default-otel-project";
      console.info(
        `No parent specified, using default: ${parent}. ` +
          "Configure with BRAINTRUST_PARENT environment variable or parent parameter.",
      );
    }

    try {
      const { OTLPTraceExporter, BatchSpanProcessor } =
        await loadOtelDependencies();

      const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-bt-parent": parent,
        ...this.options.headers,
      };

      const exporter = new OTLPTraceExporter({
        url: new URL("otel/v1/traces", apiUrl).href,
        headers,
      });

      const processor = new BatchSpanProcessor(exporter);
      this.processor = processor;

      // Conditionally wrap with filtering based on filterAISpans flag
      if (this.options.filterAISpans === true) {
        // Only enable filtering if explicitly requested
        this.aiSpanProcessor = new AISpanProcessor(
          processor,
          this.options.customFilter,
        );
      } else {
        // Use the batch processor directly without filtering (default behavior)
        this.aiSpanProcessor = processor;
      }
    } catch (error) {
      console.warn(
        "Failed to initialize BraintrustSpanProcessor:",
        error instanceof Error ? error.message : error,
      );
      // Create a no-op processor that doesn't do anything
      this.aiSpanProcessor = {
        onStart: () => {},
        onEnd: () => {},
        shutdown: () => Promise.resolve(),
        forceFlush: () => Promise.resolve(),
      };
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  onStart(span: Span, parentContext: Context): void {
    if (this.aiSpanProcessor) {
      this.aiSpanProcessor.onStart(span, parentContext);
    } else {
      // Queue the operation to run after initialization
      this.ensureInitialized().then(() => {
        if (this.aiSpanProcessor) {
          this.aiSpanProcessor.onStart(span, parentContext);
        }
      });
    }
  }

  onEnd(span: ReadableSpan): void {
    if (this.aiSpanProcessor) {
      this.aiSpanProcessor.onEnd(span);
    } else {
      // Queue the operation to run after initialization
      this.ensureInitialized().then(() => {
        if (this.aiSpanProcessor) {
          this.aiSpanProcessor.onEnd(span);
        }
      });
    }
  }

  async shutdown(): Promise<void> {
    await this.ensureInitialized();
    if (this.aiSpanProcessor) {
      return this.aiSpanProcessor.shutdown();
    }
  }

  async forceFlush(): Promise<void> {
    await this.ensureInitialized();
    if (this.aiSpanProcessor) {
      return this.aiSpanProcessor.forceFlush();
    }
  }
}

/**
 * A trace exporter that sends OpenTelemetry spans to Braintrust.
 *
 * This exporter wraps the standard OTLP trace exporter and can be used with
 * any OpenTelemetry setup, including @vercel/otel's registerOTel function,
 * NodeSDK, or custom tracer providers. It can optionally filter spans to
 * only send AI-related telemetry.
 *
 * Note: This class requires @opentelemetry/exporter-trace-otlp-http and
 * @opentelemetry/sdk-trace-base to be installed as peer dependencies.
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
  private readonly processor: BraintrustSpanProcessor;

  constructor(options: BraintrustSpanProcessorOptions = {}) {
    this.processor = new BraintrustSpanProcessor(options);
  }

  /**
   * Export spans to Braintrust by simulating span processor behavior.
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: unknown) => void,
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
