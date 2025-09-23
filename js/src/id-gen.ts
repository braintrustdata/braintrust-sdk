// ID generation system for Braintrust spans
// Supports both UUID and OpenTelemetry-compatible ID formats

import { v4 as uuidv4 } from "uuid";

/**
 * Generate random hex string of specified byte length
 */
function generateHexId(bytes: number): string {
  let result = "";
  for (let i = 0; i < bytes; i++) {
    result += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return result;
}

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
 * ID generator that generates OpenTelemetry-compatible IDs
 * Uses hex strings for compatibility with OpenTelemetry systems
 */
export class OTELIDGenerator extends IDGenerator {
  getSpanId(): string {
    // Generate 8 random bytes and convert to hex (16 characters)
    return generateHexId(8);
  }

  getTraceId(): string {
    // Generate 16 random bytes and convert to hex (32 characters)
    return generateHexId(16);
  }

  shareRootSpanId(): boolean {
    return false;
  }
}

/**
 * Factory function that creates a new ID generator instance each time.
 *
 * This eliminates global state and makes tests parallelizable.
 * Each caller gets their own generator instance.
 */
export function getIdGenerator(): IDGenerator {
  const useOtel =
    typeof process !== "undefined" &&
    process.env?.BRAINTRUST_OTEL_COMPAT?.toLowerCase() === "true";

  return useOtel ? new OTELIDGenerator() : new UUIDGenerator();
}
