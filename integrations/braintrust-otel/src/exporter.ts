// Braintrust OpenTelemetry exporter
import {
  BraintrustSpanProcessor,
  BraintrustSpanProcessorOptions,
} from "./processors";

interface ReadableSpan {
  name: string;
  parentSpanContext?: { spanId: string; traceId: string };
  attributes?: Record<string, any>;
  spanContext(): { spanId: string; traceId: string };
  parentSpanId?: string;
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
 * @example With NodeSDK:
 * ```typescript
 * import { NodeSDK } from '@opentelemetry/sdk-node';
 * import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
 * import { BraintrustExporter } from '@braintrust/otel';
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

