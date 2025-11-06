// OpenTelemetry utility functions for distributed tracing
import * as api from "@opentelemetry/api";
import {
  SpanObjectTypeV3,
  SpanComponentsV4,
  SpanComponentsV3,
  type SpanComponentsV3Data,
} from "./types";
import type { Span as BraintrustSpan } from "./types";

interface OtelSpan {
  attributes?: Record<string, any>;
}

/**
 * Convert a hex string to UUID format.
 * Hex strings are 16 or 32 characters, UUIDs are 36 characters with dashes.
 */
function hexToUuid(hex: string): string {
  // Remove any existing dashes and pad if needed
  const cleanHex = hex.replace(/-/g, "").toLowerCase();
  
  if (cleanHex.length === 32) {
    // 32 hex chars = 16 bytes = UUID
    return `${cleanHex.slice(0, 8)}-${cleanHex.slice(8, 12)}-${cleanHex.slice(12, 16)}-${cleanHex.slice(16, 20)}-${cleanHex.slice(20, 32)}`;
  } else if (cleanHex.length === 16) {
    // 16 hex chars = 8 bytes = span ID, pad to 32 for UUID
    const padded = cleanHex.padStart(32, "0");
    return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
  } else {
    // If it's already in UUID format or unexpected format, return as-is
    return hex;
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
 * import { otelContextFromSpanExport } from '@braintrust/otel';
 * import * as api from '@opentelemetry/api';
 *
 * // Service A: Create BT span and export
 * const span = logger.startSpan({ name: "service-a" });
 * const exportStr = await span.export();
 * // Send exportStr to Service B (e.g., via HTTP header)
 *
 * // Service B: Import context and create OTEL child
 * const ctx = otelContextFromSpanExport(exportStr);
 * await api.context.with(ctx, async () => {
 *   await tracer.startActiveSpan("service-b", async (span) => {
 *     // This span is now a child of the Service A span
 *     span.end();
 *   });
 * });
 * ```
 */
/**
 * Convert UUID format to hex format.
 * UUIDs are 36 chars with dashes, hex IDs are 16/32 chars without dashes.
 */
function uuidToHex(uuid: string): string {
  // Remove dashes and convert to lowercase
  return uuid.replace(/-/g, "").toLowerCase();
}

export function otelContextFromSpanExport(exportStr: string): unknown {
  // Parse the export string (handles both V3 and V4 formats)
  const components = SpanComponentsV4.fromStr(exportStr);

  // Get trace and span IDs (may be in UUID or hex format)
  let traceIdHex = components.data.root_span_id;
  let spanIdHex = components.data.span_id;

  if (!traceIdHex || !spanIdHex) {
    throw new Error(
      "Export string must contain root_span_id and span_id for distributed tracing",
    );
  }

  // Convert UUID format to hex if needed (V3 uses UUIDs, V4 uses hex)
  // UUIDs have dashes and are 36 chars, hex IDs are 16/32 chars without dashes
  if (traceIdHex.includes("-")) {
    traceIdHex = uuidToHex(traceIdHex);
  }
  if (spanIdHex.includes("-")) {
    spanIdHex = uuidToHex(spanIdHex);
  }

  // Ensure proper padding
  traceIdHex = traceIdHex.padStart(32, "0");
  spanIdHex = spanIdHex.padStart(16, "0");

  // Create SpanContext marked as remote (critical for distributed tracing)
  const spanContext = {
    traceId: traceIdHex,
    spanId: spanIdHex,
    isRemote: true,
    traceFlags: api.TraceFlags.SAMPLED,
  };

  // Create NonRecordingSpan using wrapSpanContext and set in context
  const nonRecordingSpan = api.trace.wrapSpanContext(spanContext);
  let ctx = api.trace.setSpan(api.context.active(), nonRecordingSpan);

  // Construct braintrust.parent identifier
  const braintrustParent = getBraintrustParent(
    components.data.object_type,
    components.data.object_id,
    components.data.compute_object_metadata_args,
  );

  // Set braintrust.parent in baggage so it propagates automatically
  if (braintrustParent) {
    try {
      const baggage =
        api.propagation.getBaggage(ctx) || api.propagation.createBaggage();
      ctx = api.propagation.setBaggage(
        ctx,
        baggage.setEntry("braintrust.parent", { value: braintrustParent }),
      );
    } catch (error) {
      console.error(
        "Failed to set braintrust.parent in baggage during context import:",
        error,
      );
    }
  }

  return ctx as api.Context;
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
 * import { addParentToBaggage } from '@braintrust/otel';
 * import * as api from '@opentelemetry/api';
 *
 * // Set braintrust.parent in baggage
 * addParentToBaggage("project_name:my-project");
 *
 * // Export headers (will include braintrust.parent in baggage)
 * const headers = {};
 * api.propagation.inject(api.context.active(), headers);
 * ```
 */
export function addParentToBaggage(
  parent: string,
  ctx?: api.Context,
): api.Context {
  try {
    const currentCtx = ctx || api.context.active();
    const baggage =
      api.propagation.getBaggage(currentCtx) ||
      api.propagation.createBaggage();
    return api.propagation.setBaggage(
      currentCtx,
      baggage.setEntry("braintrust.parent", { value: parent }),
    );
  } catch (error) {
    console.error("Failed to add braintrust.parent to baggage:", error);
    return ctx || api.context.active();
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
 * import { addSpanParentToBaggage } from '@braintrust/otel';
 * import * as api from '@opentelemetry/api';
 *
 * tracer.startActiveSpan("service_b", (span) => {
 *   // Copy braintrust.parent from span attribute to baggage
 *   addSpanParentToBaggage(span);
 *
 *   // Export headers (will include braintrust.parent in baggage)
 *   const headers = {};
 *   api.propagation.inject(api.context.active(), headers);
 *   span.end();
 * });
 * ```
 */
export function addSpanParentToBaggage(
  span: OtelSpan,
  ctx?: api.Context,
): api.Context | undefined {
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
 * import { parentFromHeaders } from '@braintrust/otel';
 * import { initLogger } from 'braintrust';
 *
 * // Service C receives headers from Service B
 * const headers = { traceparent: '00-trace_id-span_id-01', baggage: '...' };
 * const parent = parentFromHeaders(headers);
 *
 * const logger = initLogger({ projectName: "my-project" });
 * await logger.traced(async (span) => {
 *   span.log({ input: "BT span as child of OTEL parent" });
 * }, { name: "service_c", parent });
 * ```
 */
export function parentFromHeaders(
  headers: Record<string, string>,
): string | undefined {
  try {
    // Extract context from headers using W3C Trace Context propagator
    // This parses both traceparent and baggage headers
    const ctx = api.propagation.extract(api.context.active(), headers);

    // Get span context directly from the extracted context
    const spanContext = api.trace.getSpanContext(ctx);
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
    const baggage = api.propagation.getBaggage(ctx);
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

    // Check if braintrust is using V4 format (via BRAINTRUST_OTEL_COMPAT env var)
    // Default to V3 for compatibility
    const useV4 =
      typeof process !== "undefined" &&
      process.env?.BRAINTRUST_OTEL_COMPAT?.toLowerCase() === "true";

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

    if (useV4) {
      // Use V4 format
      const components = new SpanComponentsV4(componentsData as any);
      return components.toStr();
    } else {
      // Use V3 format (default)
      // Convert hex IDs to UUIDs for V3 format
      // V3 uses UUID format (36 chars with dashes), V4 uses hex (16/32 chars)
      const spanIdUuid = hexToUuid(spanIdHex);
      const rootSpanIdUuid = hexToUuid(traceIdHex);
      
      const v3Data: SpanComponentsV3Data = {
        object_type: objectType,
        row_id: "otel",
        span_id: spanIdUuid,
        root_span_id: rootSpanIdUuid,
      };
      
      if (computeArgs) {
        v3Data.compute_object_metadata_args = computeArgs;
      } else {
        v3Data.object_id = objectId;
      }
      
      const components = new SpanComponentsV3(v3Data);
      return components.toStr();
    }
  } catch (error) {
    console.error("parentFromHeaders: Error parsing headers:", error);
    return undefined;
  }
}

