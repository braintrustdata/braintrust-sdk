// Type definitions that don't depend on OpenTelemetry being installed
export interface OtelContext {
  getValue: (key: symbol) => unknown;
  setValue: (key: symbol, value: unknown) => OtelContext;
  deleteValue: (key: symbol) => OtelContext;
}

export interface OtelSpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: unknown;
}

export interface OtelApi {
  context: {
    active: () => OtelContext;
  };
  trace: {
    getSpan: (ctx: OtelContext) => unknown;
    getSpanContext: (ctx: OtelContext) => OtelSpanContext | undefined;
    setSpan: (ctx: OtelContext, span: unknown) => OtelContext;
    wrapSpanContext: (spanContext: unknown) => unknown;
  };
  propagation: {
    getBaggage: (ctx: OtelContext) => any;
    createBaggage: () => any;
    setBaggage: (ctx: OtelContext, baggage: any) => OtelContext;
    extract: (ctx: OtelContext, headers: Record<string, string>) => OtelContext;
  };
  TraceFlags?: {
    SAMPLED: number;
  };
}

export interface SpanProcessor {
  onStart(span: Span, parentContext: OtelContext): void;
  onEnd(span: ReadableSpan): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

export interface SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
}

export interface ReadableSpan {
  name: string;
  parentSpanContext?: { spanId: string; traceId: string };
  attributes?: Record<string, any>;
  spanContext(): { spanId: string; traceId: string };
  parentSpanId?: string;
}

export interface Span extends ReadableSpan {
  end(): void;
  setAttributes(attributes: Record<string, any>): void;
  setStatus(status: { code: number; message?: string }): void;
}

export type ExportResult = { code: number; error?: Error };

// State management
let otelApi: OtelApi | null = null;
let otelSdk: {
  BatchSpanProcessor: new (exporter: unknown) => SpanProcessor;
} | null = null;
let otelExporter: {
  OTLPTraceExporter: new (config: unknown) => SpanExporter;
} | null = null;
let OTEL_AVAILABLE: boolean | null = null; // null = not checked yet, true = available, false = not available
let otelInitPromise: Promise<void> | null = null;
let otelExporterInitPromise: Promise<void> | null = null;

export const OTEL_NOT_INSTALLED_MESSAGE =
  "OpenTelemetry packages are not installed. " +
  "Install them with: npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions";

export const OTEL_STILL_LOADING_MESSAGE =
  "OpenTelemetry packages are still loading (pure ESM environment detected). " +
  "In ESM environments, OpenTelemetry must be pre-initialized before use. " +
  "This only affects pure ESM environments; CommonJS/Node.js loads instantly.";

export const OTEL_ESM_PRE_INIT_REQUIRED_MESSAGE =
  "OpenTelemetry cannot be loaded asynchronously in ESM environments. " +
  "Please ensure OpenTelemetry packages are imported and initialized before using Braintrust OTEL features.";

// Getters for loaded modules
export function getOtelApi(): OtelApi | null {
  return otelApi;
}

export function getOtelSdk(): {
  BatchSpanProcessor: new (exporter: unknown) => SpanProcessor;
} | null {
  return otelSdk;
}

export function getOtelExporter(): {
  OTLPTraceExporter: new (config: unknown) => SpanExporter;
} | null {
  return otelExporter;
}

export function getOtelAvailable(): boolean | null {
  return OTEL_AVAILABLE;
}

/**
 * Get or create a promise that resolves when OTEL is loaded.
 */
export function getOtelLoadPromise(): Promise<void> {
  // If already loaded, return resolved promise
  if (OTEL_AVAILABLE === true) {
    return Promise.resolve();
  }

  // If already loading, return existing promise
  if (otelInitPromise) {
    return otelInitPromise;
  }

  // Create async promise for loading
  otelInitPromise = ensureOtelLoaded().catch(() => {
    // Promise will resolve even if OTEL is not available
    // The availability check will happen when it's used
  });
  return otelInitPromise;
}

function setOtelModules(
  apiModule: {
    context: unknown;
    trace: unknown;
    propagation: unknown;
    TraceFlags?: { SAMPLED: number };
  },
  sdkModule: { BatchSpanProcessor: new (exporter: unknown) => SpanProcessor },
): void {
  otelApi = {
    context: apiModule.context as unknown as OtelApi["context"],
    trace: apiModule.trace as unknown as OtelApi["trace"],
    propagation: apiModule.propagation as unknown as OtelApi["propagation"],
    TraceFlags: apiModule.TraceFlags,
  };
  otelSdk = {
    BatchSpanProcessor: sdkModule.BatchSpanProcessor as unknown as {
      new (exporter: unknown): SpanProcessor;
    },
  };
  OTEL_AVAILABLE = true;
}

function handleOtelImportFailure(): void {
  console.warn(OTEL_NOT_INSTALLED_MESSAGE);
  OTEL_AVAILABLE = false;
}

function setOtelExporterModule(exporterModule: {
  OTLPTraceExporter: new (config: unknown) => SpanExporter;
}): void {
  otelExporter = {
    OTLPTraceExporter: exporterModule.OTLPTraceExporter as {
      new (config: unknown): SpanExporter;
    },
  };
}

export function checkOtelAvailableOrThrow(): void {
  if (OTEL_AVAILABLE === null) {
    throw new Error(OTEL_STILL_LOADING_MESSAGE);
  }

  if (!OTEL_AVAILABLE) {
    throw new Error(OTEL_NOT_INSTALLED_MESSAGE);
  }
}

/**
 * Load OTEL API and SDK modules.
 */
async function loadOtelModules(): Promise<void> {
  try {
    // Dynamically import OpenTelemetry optional modules
    const [apiModule, sdkModule] = await Promise.all([
      import("@opentelemetry/api" as string),
      import("@opentelemetry/sdk-trace-base" as string),
    ]);

    setOtelModules(apiModule, sdkModule);
  } catch {
    // OTEL not installed or import failed
    handleOtelImportFailure();
  }
}

/**
 * Load OTEL exporter module.
 */
async function loadOtelExporter(): Promise<void> {
  try {
    const exporterModule = await import(
      "@opentelemetry/exporter-trace-otlp-http" as string
    );
    
    setOtelExporterModule(exporterModule);
  } catch {
    // Optional exporter not installed, that's okay
  }
}

/**
 * Ensure OTEL is loaded asynchronously and throw if not available.
 * Returns a promise that resolves when loading is complete.
 * Throws an error if OTEL is still loading or not available.
 */
export async function ensureOtelLoaded(): Promise<void> {
  // Already checked (success or failure)
  if (OTEL_AVAILABLE !== null) {
    checkOtelAvailableOrThrow();
    return;
  }

  // Already loading
  if (otelInitPromise) {
    await otelInitPromise;
    checkOtelAvailableOrThrow();
    return;
  }

  // Start loading
  otelInitPromise = loadOtelModules();
  await otelInitPromise;
  checkOtelAvailableOrThrow();
}

/**
 * Ensure OTEL exporter is loaded asynchronously.
 * Returns a promise that resolves when loading is complete.
 * Throws an error if OTEL is not available.
 */
export async function ensureOtelExporterLoaded(): Promise<void> {
  // First ensure base OTEL is loaded (this will throw if not available)
  await ensureOtelLoaded();

  // Already loaded
  if (otelExporter) {
    return;
  }

  // Already loading
  if (otelExporterInitPromise) {
    await otelExporterInitPromise;
    return;
  }

  // Start loading
  otelExporterInitPromise = loadOtelExporter();
  await otelExporterInitPromise;
}

