// Simple logger utility for OTEL warnings
const logger = {
  warn: (message: string) => {
    console.warn(`[braintrust:otel] ${message}`);
  },
};

let OTEL_AVAILABLE = false;
let trace: any;
let OTLPTraceExporter: any;
let BatchSpanProcessor: any;
let SimpleSpanProcessor: any;

// Try to load OpenTelemetry dependencies
try {
  // These imports should not fail if OpenTelemetry is not installed
  const otelApi = require("@opentelemetry/api");
  const otelExporter = require("@opentelemetry/exporter-otlp-http");
  const otelSdkTrace = require("@opentelemetry/sdk-trace-base");

  trace = otelApi.trace;
  OTLPTraceExporter = otelExporter.OTLPTraceExporter;
  BatchSpanProcessor = otelSdkTrace.BatchSpanProcessor;
  SimpleSpanProcessor = otelSdkTrace.SimpleSpanProcessor;

  OTEL_AVAILABLE = true;
} catch (error) {
  logger.warn(
    "OpenTelemetry packages are not installed. " +
      "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http",
  );

  // Create stub classes if OpenTelemetry is not available
  class OTLPTraceExporterStub {
    constructor(...args: any[]) {
      throw new Error(
        "OpenTelemetry packages are not installed. " +
          "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http",
      );
    }
  }

  class BatchSpanProcessorStub {
    constructor(...args: any[]) {
      throw new Error(
        "OpenTelemetry packages are not installed. " +
          "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http",
      );
    }
  }

  class SimpleSpanProcessorStub {
    constructor(...args: any[]) {
      throw new Error(
        "OpenTelemetry packages are not installed. " +
          "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http",
      );
    }
  }

  const traceStub = {
    getTracerProvider: () => {
      throw new Error(
        "OpenTelemetry packages are not installed. " +
          "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http",
      );
    },
  };

  OTLPTraceExporter = OTLPTraceExporterStub;
  BatchSpanProcessor = BatchSpanProcessorStub;
  SimpleSpanProcessor = SimpleSpanProcessorStub;
  trace = traceStub;
}

const LLM_PREFIXES = ["gen_ai.", "braintrust.", "llm.", "ai."];

export interface CustomFilter {
  (span: any): boolean | null | undefined;
}

export class LLMSpanProcessor {
  private _processor: any;
  private _customFilter?: CustomFilter;

  constructor(processor: any, customFilter?: CustomFilter) {
    this._processor = processor;
    this._customFilter = customFilter;
  }

  onStart(span: any, parentContext?: any): void {
    this._processor.onStart(span, parentContext);
  }

  onEnd(span: any): void {
    if (this._shouldKeepLLMSpan(span)) {
      this._processor.onEnd(span);
    }
  }

  shutdown(): Promise<void> {
    return this._processor.shutdown();
  }

  forceFlush(timeoutMillis: number = 30000): Promise<void> {
    return this._processor.forceFlush(timeoutMillis);
  }

  private _shouldKeepLLMSpan(span: any): boolean {
    if (!span) {
      return false;
    }

    // Always keep root spans (no parent)
    if (!span.parentSpanId || span.parentSpanId === "0000000000000000") {
      return true;
    }

    // Apply custom filter if provided
    if (this._customFilter) {
      const customResult = this._customFilter(span);
      if (customResult === true) {
        return true;
      } else if (customResult === false) {
        return false;
      }
      // customResult is null/undefined - continue with default logic
    }

    // Check span name for LLM prefixes
    if (
      span.name &&
      LLM_PREFIXES.some((prefix) => span.name.startsWith(prefix))
    ) {
      return true;
    }

    // Check attributes for LLM prefixes
    if (span.attributes) {
      for (const attrName of Object.keys(span.attributes)) {
        if (LLM_PREFIXES.some((prefix) => attrName.startsWith(prefix))) {
          return true;
        }
      }
    }

    return false;
  }
}

export interface OtelExporterOptions {
  url?: string;
  apiKey?: string;
  parent?: string;
  headers?: Record<string, string>;
  [key: string]: any;
}

export class OtelExporter extends OTLPTraceExporter {
  public parent?: string;

  constructor(options: OtelExporterOptions = {}) {
    const baseUrl =
      process.env.BRAINTRUST_API_URL || "https://api.braintrust.dev";
    const endpoint =
      options.url || `${baseUrl.replace(/\/$/, "")}/otel/v1/traces`;
    const apiKey = options.apiKey || process.env.BRAINTRUST_API_KEY;
    const parent = options.parent || process.env.BRAINTRUST_PARENT;
    const headers = options.headers || {};

    if (!apiKey) {
      throw new Error(
        "API key is required. Provide it via apiKey parameter or BRAINTRUST_API_KEY environment variable.",
      );
    }

    const exporterHeaders = {
      Authorization: `Bearer ${apiKey}`,
      ...headers,
    };

    if (parent) {
      exporterHeaders["x-bt-parent"] = parent;
    }

    this.parent = parent;

    super({
      ...options,
      url: endpoint,
      headers: exporterHeaders,
    });
  }
}

export interface ProcessorOptions {
  apiKey?: string;
  parent?: string;
  apiUrl?: string;
  enableLlmFiltering?: boolean;
  customFilter?: CustomFilter;
  headers?: Record<string, string>;
}

export class Processor {
  private _exporter: OtelExporter;
  private _processor: any;

  constructor(options: ProcessorOptions = {}) {
    // Convert apiUrl to the full endpoint URL that OtelExporter expects
    let exporterUrl: string | undefined;
    if (options.apiUrl) {
      exporterUrl = `${options.apiUrl.replace(/\/$/, "")}/otel/v1/traces`;
    }

    this._exporter = new OtelExporter({
      url: exporterUrl,
      apiKey: options.apiKey,
      parent: options.parent,
      headers: options.headers,
    });

    if (!OTEL_AVAILABLE) {
      throw new Error(
        "OpenTelemetry packages are not installed. " +
          "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http",
      );
    }

    // Always create a BatchSpanProcessor first
    const batchProcessor = new BatchSpanProcessor(this._exporter);

    if (options.enableLlmFiltering) {
      // Wrap the BatchSpanProcessor with LLM filtering
      this._processor = new LLMSpanProcessor(
        batchProcessor,
        options.customFilter,
      );
    } else {
      // Use BatchSpanProcessor directly
      this._processor = batchProcessor;
    }
  }

  onStart(span: any, parentContext?: any): void {
    this._processor.onStart(span, parentContext);
  }

  onEnd(span: any): void {
    this._processor.onEnd(span);
  }

  shutdown(): Promise<void> {
    return this._processor.shutdown();
  }

  forceFlush(timeoutMillis: number = 30000): Promise<void> {
    return this._processor.forceFlush(timeoutMillis);
  }

  get exporter(): OtelExporter {
    return this._exporter;
  }

  get processor(): any {
    return this._processor;
  }
}

function _autoConfigureBraintrustOtel(): void {
  if (!OTEL_AVAILABLE) {
    logger.warn(
      "BRAINTRUST_OTEL_ENABLE is set but OpenTelemetry packages are not installed. " +
        "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-otlp-http",
    );
    return;
  }

  // Get the global tracer provider
  const provider = trace.getTracerProvider();

  // Check if the provider has the addSpanProcessor method
  if (!provider || typeof provider.addSpanProcessor !== "function") {
    logger.warn(
      "BRAINTRUST_OTEL_ENABLE is set but no tracer provider is set up. " +
        "Please set a TracerProvider first. " +
        "See: https://opentelemetry.io/docs/instrumentation/javascript/getting-started/",
    );
    return;
  }

  try {
    // Check if LLM filtering is enabled
    const filterLlmEnabled =
      (process.env.BRAINTRUST_OTEL_ENABLE_LLM_FILTER || "").toLowerCase() ===
      "true";

    // Create our processor using the new Processor class
    const processor = new Processor({ enableLlmFiltering: filterLlmEnabled });

    // Add our processor to the global tracer provider
    provider.addSpanProcessor(processor);
  } catch (error) {
    logger.warn(
      `Failed to auto-configure Braintrust OpenTelemetry exporter: ${error}`,
    );
  }
}

// Auto-configure OpenTelemetry if BRAINTRUST_OTEL_ENABLE is set
if ((process.env.BRAINTRUST_OTEL_ENABLE || "").toLowerCase() === "true") {
  _autoConfigureBraintrustOtel();
}

export { OTEL_AVAILABLE };
