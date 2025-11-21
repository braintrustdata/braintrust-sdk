// ID generation system for Braintrust spans
// Supports both UUID and OpenTelemetry-compatible ID formats

import { v4 as uuidv4 } from "uuid";

/**
 * Abstract base class for ID generators
 */
export abstract class IDGenerator {
  /**
   * Generate a span ID
   */
  abstract getSpanId(): string;

  /**
   * Generate a trace ID
   */
  abstract getTraceId(): string;

  /**
   * Return true if the generator should use span_id as root_span_id for backwards compatibility
   */
  abstract shareRootSpanId(): boolean;
}

/**
 * ID generator that uses UUID4 for both span and trace IDs
 */
export class UUIDGenerator extends IDGenerator {
  getSpanId(): string {
    return uuidv4();
  }

  getTraceId(): string {
    return uuidv4();
  }

  shareRootSpanId(): boolean {
    return true;
  }
}

/**
 * Factory function that creates a new ID generator instance each time.
 *
 * This eliminates global state and makes tests parallelizable.
 * Each caller gets their own generator instance.
 */
export function getIdGenerator(): IDGenerator {
  return globalThis.BRAINTRUST_ID_GENERATOR !== undefined
    ? new globalThis.BRAINTRUST_ID_GENERATOR()
    : new UUIDGenerator();
}
