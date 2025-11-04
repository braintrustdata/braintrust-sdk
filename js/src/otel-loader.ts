// OpenTelemetry loader with sync and async interfaces
import { preInitializeOtelContext } from "./otel/context";

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

/**
 * Pass in the OpenTelemetry modules to the preInitializeOtel function.
 * This initializes both the main OTEL loader and the context manager.
 *
 * In ESM environments, this must be async to properly initialize the context manager.
 * In CommonJS environments, it can be synchronous.
 *
 * @param apiModule - The @opentelemetry/api module
 * @param sdkModule - The @opentelemetry/sdk-trace-base module
 * @param exporterModule - Optional: The @opentelemetry/exporter-trace-otlp-http module
 * @returns Promise that resolves when initialization is complete (ESM) or void (CommonJS)
 *
 * @example
 * ```typescript
 * // In ESM file (e.g., app.mjs or with "type": "module" in package.json)
 * import * as api from '@opentelemetry/api';
 * import * as sdk from '@opentelemetry/sdk-trace-base';
 * import * as exporter from '@opentelemetry/exporter-trace-otlp-http';
 * import { preInitializeOtel } from 'braintrust';
 *
 * // Pre-initialize OTEL before using Braintrust OTEL features
 * await preInitializeOtel(api, sdk, exporter);
 *
 * // Now you can use Braintrust OTEL features
 * import { BraintrustSpanProcessor } from 'braintrust';
 * const processor = new BraintrustSpanProcessor({ apiKey: '...' });
 * ```
 */
export async function preInitializeOtel(
  apiModule: {
    context: unknown;
    trace: unknown;
    propagation: unknown;
    TraceFlags?: { SAMPLED: number };
  },
  sdkModule: {
    BatchSpanProcessor: unknown;
  },
  exporterModule?: {
    OTLPTraceExporter: unknown;
  },
): Promise<void> {
  setOtelModules(
    apiModule,
    sdkModule as {
      BatchSpanProcessor: new (exporter: unknown) => SpanProcessor;
    },
  );
  if (exporterModule) {
    setOtelExporterModule(
      exporterModule as {
        OTLPTraceExporter: new (config: unknown) => SpanExporter;
      },
    );
  }

  // Initialize the context manager
  // Use static import - same module instance ensures state is shared
  await preInitializeOtelContext(apiModule);
}

export function checkOtelAvailableOrThrow(): void {
  if (OTEL_AVAILABLE === null) {
    throw new Error(OTEL_STILL_LOADING_MESSAGE);
  }

  if (!OTEL_AVAILABLE) {
    throw new Error(OTEL_NOT_INSTALLED_MESSAGE);
  }
}

// Sync loader interface - for CommonJS/Node.js environments
export interface SyncOtelLoader {
  ensureLoaded(): void;
  checkAvailable(): void;
  ensureExporterLoaded(): void;
}

// Async loader interface - for environments that support async loading
export interface AsyncOtelLoader {
  ensureLoaded(): Promise<void>;
  checkAvailable(): void;
  ensureExporterLoaded(): Promise<void>;
}

class SyncOtelLoaderImpl implements SyncOtelLoader {
  ensureLoaded(): void {
    if (OTEL_AVAILABLE !== null) {
      return;
    }

    // CommonJS/Node.js: Load via synchronous require()
    if (typeof require !== "undefined") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- Synchronous dynamic require
        const apiModule = require("@opentelemetry/api");
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- Synchronous dynamic require
        const sdkModule = require("@opentelemetry/sdk-trace-base");

        setOtelModules(apiModule, sdkModule);

        // Also initialize the context manager synchronously in CommonJS
        // Use require to avoid async issues
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires -- Synchronous dynamic require
          const contextModule = require("./otel/context");
          // Use the synchronous version for CommonJS
          if (contextModule.preInitializeOtelContextSync) {
            contextModule.preInitializeOtelContextSync(apiModule);
          }
        } catch {
          // Context module might not be available, that's okay
        }
        return;
      } catch {
        handleOtelImportFailure();
        return;
      }
    }
    // Don't attempt async loading it's not possible in ESM
    throw new Error(OTEL_ESM_PRE_INIT_REQUIRED_MESSAGE);
  }

  checkAvailable(): void {
    checkOtelAvailableOrThrow();
  }

  ensureExporterLoaded(): void {
    this.ensureLoaded();
    this.checkAvailable();

    if (otelExporter) {
      return;
    }

    // CommonJS/Node.js
    if (typeof require !== "undefined") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- Synchronous dynamic require
        const exporterModule = require("@opentelemetry/exporter-trace-otlp-http");
        setOtelExporterModule(exporterModule);
        return;
      } catch {
        // optional exporter not installed
      }
    }
  }
}

// Async loader implementation
class AsyncOtelLoaderImpl implements AsyncOtelLoader {
  async ensureLoaded(): Promise<void> {
    if (OTEL_AVAILABLE !== null) {
      return;
    }

    if (otelInitPromise) {
      await otelInitPromise;
      return;
    }
    // This will throw to indicate pre-initialization is required
    throw new Error(OTEL_ESM_PRE_INIT_REQUIRED_MESSAGE);
  }

  checkAvailable(): void {
    checkOtelAvailableOrThrow();
  }

  async ensureExporterLoaded(): Promise<void> {
    await this.ensureLoaded();
    this.checkAvailable();

    if (otelExporter || otelExporterInitPromise) {
      if (otelExporterInitPromise) {
        await otelExporterInitPromise;
      }
      return;
    }
  }
}

export const syncOtelLoader: SyncOtelLoader = new SyncOtelLoaderImpl();
export const asyncOtelLoader: AsyncOtelLoader = new AsyncOtelLoaderImpl();

function detectModuleSystem(): "cjs" | "esm" {
  if (typeof require !== "undefined") {
    return "cjs";
  }
  return "esm";
}

export function getOtelLoader(): SyncOtelLoader | AsyncOtelLoader {
  const moduleSystem = detectModuleSystem();
  if (moduleSystem === "cjs") {
    return syncOtelLoader;
  }
  return asyncOtelLoader;
}

/**
 * Smart ensure loaded that auto-detects environment.
 * For CommonJS: Synchronously loads via require()
 * For ESM: Throws error indicating pre-initialization is required
 */
export function ensureOtelLoaded(): void {
  const loader = getOtelLoader();
  if (loader === syncOtelLoader) {
    loader.ensureLoaded();
  } else {
    // For ESM, we can't load synchronously, so throw
    throw new Error(
      OTEL_ESM_PRE_INIT_REQUIRED_MESSAGE +
        " In ESM environments, ensure OpenTelemetry packages are imported at the top level before using Braintrust OTEL features.",
    );
  }
}

/**
 * Smart ensure exporter loaded that auto-detects environment.
 */
export function ensureOtelExporterLoaded(): void {
  const loader = getOtelLoader();
  if (loader === syncOtelLoader) {
    loader.ensureExporterLoaded();
  } else {
    // For ESM, we can't load synchronously, so throw
    throw new Error(
      OTEL_ESM_PRE_INIT_REQUIRED_MESSAGE +
        " In ESM environments, ensure OpenTelemetry packages are imported at the top level before using Braintrust OTEL features.",
    );
  }
}

// Legacy exports for backward compatibility
export function ensureOtelLoadedSync(): void {
  syncOtelLoader.ensureLoaded();
}

export async function ensureOtelLoadedAsync(): Promise<void> {
  await asyncOtelLoader.ensureLoaded();
}

export function ensureOtelExporterLoadedSync(): void {
  syncOtelLoader.ensureExporterLoaded();
}

export async function ensureOtelExporterLoadedAsync(): Promise<void> {
  await asyncOtelLoader.ensureExporterLoaded();
}
