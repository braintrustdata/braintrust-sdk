/**
 * Type definitions for Braintrust span integration.
 * 
 * These types define the interface that Braintrust spans must implement
 * to work with the OTEL integration. This allows @braintrust/otel to be
 * independent of the main braintrust package.
 */

import * as uuid from "uuid";

/**
 * Parent span identification for context propagation.
 */
export interface ContextParentSpanIds {
  rootSpanId: string;
  spanParents: string[];
}

/**
 * Minimal Span interface required for OTEL integration.
 * 
 * Any span that implements this interface can be used with
 * OtelContextManager for context propagation.
 */
export interface Span {
  spanId: string;
  rootSpanId: string;
  
  /**
   * Optional method to get OTEL parent information.
   * Used by BraintrustSpanProcessor to set braintrust.parent attribute.
   */
  _getOtelParent?(): string | undefined;
}

/**
 * Abstract base class for context managers.
 * 
 * Context managers handle span context propagation, allowing spans
 * to be nested and retrieved from the current execution context.
 */
export abstract class ContextManager {
  /**
   * Get the parent span IDs from the current context.
   * Returns undefined if no parent context exists.
   */
  abstract getParentSpanIds(): ContextParentSpanIds | undefined;
  
  /**
   * Run a callback within the context of a span.
   * The span will be available as the current span during callback execution.
   */
  abstract runInContext<R>(span: Span, callback: () => R): R;
  
  /**
   * Get the current span from the execution context.
   * Returns undefined if no span is currently active.
   */
  abstract getCurrentSpan(): Span | undefined;
}

/**
 * Span component types for distributed tracing.
 */
export enum SpanObjectTypeV3 {
  UNKNOWN = 0,
  EXPERIMENT = 1,
  PROJECT_LOGS = 2,
  PLAYGROUND_LOGS = 3,
}

/**
 * Interface for SpanComponentsV3 data used in distributed tracing.
 * This allows parsing V3 format span export strings without
 * depending on the full braintrust util package.
 */
export interface SpanComponentsV3Data {
  object_type: SpanObjectTypeV3;
  object_id?: string | null;
  compute_object_metadata_args?: Record<string, unknown> | null;
  row_id?: string | null;
  span_id?: string | null;
  root_span_id?: string | null;
  propagated_event?: Record<string, unknown> | null;
}

/**
 * Interface for SpanComponentsV4 used in distributed tracing.
 * This allows parsing and creating span export strings without
 * depending on the full braintrust util package.
 */
export interface SpanComponentsV4Data {
  object_type: number;
  object_id?: string | null;
  compute_object_metadata_args?: Record<string, unknown> | null;
  row_id: string;
  span_id: string;
  root_span_id: string;
}

// ===== Byte utility functions =====
function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const uint8Array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    uint8Array[i] = binary.charCodeAt(i);
  }
  return uint8Array;
}

function uint8ArrayToString(uint8Array: Uint8Array): string {
  const decoder = new TextDecoder("utf-8");
  return decoder.decode(uint8Array);
}

function stringToUint8Array(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

// ===== Hex conversion utilities =====
/**
 * Try to convert hex string to 16-byte binary (for trace IDs)
 */
function tryMakeHexTraceId(
  s: string,
): { bytes: Uint8Array; isHex: true } | { bytes: undefined; isHex: false } {
  try {
    if (typeof s === "string" && s.length === 32) {
      // 32 hex chars = 16 bytes
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) {
        const hex = s.substr(i * 2, 2);
        const byte = parseInt(hex, 16);
        if (isNaN(byte)) throw new Error();
        bytes[i] = byte;
      }
      return { bytes, isHex: true };
    }
  } catch {
    // Fall through
  }
  return { bytes: undefined, isHex: false };
}

/**
 * Try to convert hex string to 8-byte binary (for span IDs)
 */
function tryMakeHexSpanId(
  s: string,
): { bytes: Uint8Array; isHex: true } | { bytes: undefined; isHex: false } {
  try {
    if (typeof s === "string" && s.length === 16) {
      // 16 hex chars = 8 bytes
      const bytes = new Uint8Array(8);
      for (let i = 0; i < 8; i++) {
        const hex = s.substr(i * 2, 2);
        const byte = parseInt(hex, 16);
        if (isNaN(byte)) throw new Error();
        bytes[i] = byte;
      }
      return { bytes, isHex: true };
    }
  } catch {
    // Fall through
  }
  return { bytes: undefined, isHex: false };
}

// ===== SpanComponentsV3 Implementation =====
const ENCODING_VERSION_NUMBER_V3 = 3;
const INVALID_ENCODING_ERRMSG_V3 = `SpanComponents string is not properly encoded. This library only supports encoding versions up to ${ENCODING_VERSION_NUMBER_V3}. Please make sure the SDK library used to decode the SpanComponents is at least as new as any library used to encode it.`;

enum InternalSpanComponentUUIDFieldsV3 {
  OBJECT_ID = 1,
  ROW_ID = 2,
  SPAN_ID = 3,
  ROOT_SPAN_ID = 4,
}

const _INTERNAL_SPAN_COMPONENT_UUID_FIELDS_ID_TO_NAME_V3: Record<
  InternalSpanComponentUUIDFieldsV3,
  string
> = {
  [InternalSpanComponentUUIDFieldsV3.OBJECT_ID]: "object_id",
  [InternalSpanComponentUUIDFieldsV3.ROW_ID]: "row_id",
  [InternalSpanComponentUUIDFieldsV3.SPAN_ID]: "span_id",
  [InternalSpanComponentUUIDFieldsV3.ROOT_SPAN_ID]: "root_span_id",
};

function tryMakeUuid(
  s: string,
): { bytes: Uint8Array; isUUID: true } | { bytes: undefined; isUUID: false } {
  try {
    const ret = uuid.parse(s);
    if (ret.length !== 16) {
      throw new Error();
    }
    return { bytes: new Uint8Array(ret), isUUID: true };
  } catch {
    return { bytes: undefined, isUUID: false };
  }
}

/**
 * Implementation of SpanComponentsV3 for distributed tracing.
 * This class handles deserialization of V3 format span export strings.
 * V2 and older formats are not supported (will throw error).
 */
export class SpanComponentsV3 {
  data: SpanComponentsV3Data;

  constructor(data: SpanComponentsV3Data) {
    this.data = data;
  }

  /**
   * Serialize span components to a V3 export string (binary format, base64 encoded).
   */
  toStr(): string {
    const jsonObj: Record<string, unknown> = {
      compute_object_metadata_args:
        this.data.compute_object_metadata_args || undefined,
      propagated_event: this.data.propagated_event || undefined,
    };
    
    // Filter out undefined values
    Object.keys(jsonObj).forEach((key) => {
      if (jsonObj[key] === undefined) {
        delete jsonObj[key];
      }
    });

    const allBuffers: Array<Uint8Array> = [];
    allBuffers.push(
      new Uint8Array([ENCODING_VERSION_NUMBER_V3, this.data.object_type]),
    );

    const uuidEntries: Array<Uint8Array> = [];
    
    function addUuidField(
      origVal: string,
      fieldId: InternalSpanComponentUUIDFieldsV3,
    ) {
      const ret = tryMakeUuid(origVal);
      if (ret.isUUID) {
        uuidEntries.push(
          concatUint8Arrays(new Uint8Array([fieldId]), ret.bytes),
        );
      } else {
        jsonObj[_INTERNAL_SPAN_COMPONENT_UUID_FIELDS_ID_TO_NAME_V3[fieldId]] =
          origVal;
      }
    }
    
    if (this.data.object_id) {
      addUuidField(
        this.data.object_id,
        InternalSpanComponentUUIDFieldsV3.OBJECT_ID,
      );
    }
    if (this.data.row_id) {
      addUuidField(
        this.data.row_id,
        InternalSpanComponentUUIDFieldsV3.ROW_ID,
      );
    }
    if (this.data.span_id) {
      addUuidField(
        this.data.span_id,
        InternalSpanComponentUUIDFieldsV3.SPAN_ID,
      );
    }
    if (this.data.root_span_id) {
      addUuidField(
        this.data.root_span_id,
        InternalSpanComponentUUIDFieldsV3.ROOT_SPAN_ID,
      );
    }

    if (uuidEntries.length > 255) {
      throw new Error("Impossible: too many UUID entries to encode");
    }
    
    allBuffers.push(new Uint8Array([uuidEntries.length]));
    allBuffers.push(...uuidEntries);
    
    if (Object.keys(jsonObj).length > 0) {
      allBuffers.push(stringToUint8Array(JSON.stringify(jsonObj)));
    }
    
    return uint8ArrayToBase64(concatUint8Arrays(...allBuffers));
  }

  /**
   * Parse a V3 export string into span components.
   * V2 and older formats are not supported.
   */
  static fromStr(s: string): SpanComponentsV3 {
    try {
      const rawBytes = base64ToUint8Array(s);
      const jsonObj: Record<string, unknown> = {};

      if (rawBytes[0] < ENCODING_VERSION_NUMBER_V3) {
        // V2 and older formats are not supported
        throw new Error(
          `Unsupported encoding version: ${rawBytes[0]}. Only V3 and V4 are supported.`,
        );
      }

      if (rawBytes[0] !== ENCODING_VERSION_NUMBER_V3) {
        // This should not happen if we're calling this from V4 parser, but handle it
        throw new Error(`Expected V3 encoding version ${ENCODING_VERSION_NUMBER_V3}, got ${rawBytes[0]}`);
      }

      jsonObj["object_type"] = rawBytes[1];
      const numUuidEntries = rawBytes[2];
      let byteOffset = 3;

      for (let i = 0; i < numUuidEntries; ++i) {
        const fieldId = rawBytes[byteOffset] as InternalSpanComponentUUIDFieldsV3;
        if (
          !Object.values(InternalSpanComponentUUIDFieldsV3).includes(fieldId)
        ) {
          throw new Error(`Invalid field ID: ${fieldId}`);
        }
        const fieldBytes = rawBytes.subarray(byteOffset + 1, byteOffset + 17);
        byteOffset += 17;
        jsonObj[_INTERNAL_SPAN_COMPONENT_UUID_FIELDS_ID_TO_NAME_V3[fieldId]] =
          uuid.stringify(fieldBytes);
      }

      if (byteOffset < rawBytes.length) {
        const remainingJsonObj = JSON.parse(
          uint8ArrayToString(rawBytes.subarray(byteOffset)),
        );
        Object.assign(jsonObj, remainingJsonObj);
      }

      // Validate required fields
      if (typeof jsonObj.object_type !== 'number') {
        throw new Error('Missing or invalid required field: object_type');
      }

      return new SpanComponentsV3(jsonObj as unknown as SpanComponentsV3Data);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`${INVALID_ENCODING_ERRMSG_V3} Error: ${error.message}`);
      }
      throw new Error(INVALID_ENCODING_ERRMSG_V3);
    }
  }
}

// ===== SpanComponentsV4 Implementation =====
const ENCODING_VERSION_NUMBER_V4 = 4;
const INVALID_ENCODING_ERRMSG_V4 = `SpanComponents string is not properly encoded. This library only supports encoding versions up to ${ENCODING_VERSION_NUMBER_V4}. Please make sure the SDK library used to decode the SpanComponents is at least as new as any library used to encode it.`;

enum Fields {
  OBJECT_ID = 1,
  ROW_ID = 2,
  SPAN_ID = 3, // 8-byte hex
  ROOT_SPAN_ID = 4, // 16-byte hex
}

const FIELDS_ID_TO_NAME: Record<Fields, string> = {
  [Fields.OBJECT_ID]: "object_id",
  [Fields.ROW_ID]: "row_id",
  [Fields.SPAN_ID]: "span_id",
  [Fields.ROOT_SPAN_ID]: "root_span_id",
};

/**
 * Implementation of SpanComponentsV4 for distributed tracing.
 * This class handles serialization and deserialization of span export strings
 * using binary format with base64 encoding.
 */
export class SpanComponentsV4 {
  data: SpanComponentsV4Data;

  constructor(data: SpanComponentsV4Data) {
    this.data = data;
  }

  /**
   * Serialize span components to a V4 export string (binary format, base64 encoded).
   */
  toStr(): string {
    // V4-style binary encoding with hex string compression
    // Binary format: version_byte + object_type_byte + num_hex_fields + hex_entries + json_remainder
    const jsonObj: Record<string, unknown> = {
      compute_object_metadata_args:
        this.data.compute_object_metadata_args || undefined,
    };

    // Filter out undefined values
    Object.keys(jsonObj).forEach((key) => {
      if (jsonObj[key] === undefined) {
        delete jsonObj[key];
      }
    });

    const allBuffers: Array<Uint8Array> = [];
    allBuffers.push(
      new Uint8Array([ENCODING_VERSION_NUMBER_V4, this.data.object_type]),
    );

    const hexEntries: Array<Uint8Array> = [];

    function addHexField(origVal: string, fieldId: Fields) {
      let hexResult:
        | { bytes: Uint8Array; isHex: true }
        | { bytes: undefined; isHex: false };

      if (fieldId === Fields.SPAN_ID) {
        hexResult = tryMakeHexSpanId(origVal);
      } else if (fieldId === Fields.ROOT_SPAN_ID) {
        hexResult = tryMakeHexTraceId(origVal);
      } else {
        hexResult = { bytes: undefined, isHex: false };
      }

      if (hexResult.isHex) {
        hexEntries.push(
          concatUint8Arrays(new Uint8Array([fieldId]), hexResult.bytes),
        );
      } else {
        jsonObj[FIELDS_ID_TO_NAME[fieldId]] = origVal;
      }
    }

    if (this.data.object_id) {
      addHexField(this.data.object_id, Fields.OBJECT_ID);
    }
    if (this.data.row_id) {
      addHexField(this.data.row_id, Fields.ROW_ID);
    }
    if (this.data.span_id) {
      addHexField(this.data.span_id, Fields.SPAN_ID);
    }
    if (this.data.root_span_id) {
      addHexField(this.data.root_span_id, Fields.ROOT_SPAN_ID);
    }

    if (hexEntries.length > 255) {
      throw new Error("Impossible: too many hex entries to encode");
    }

    allBuffers.push(new Uint8Array([hexEntries.length]));
    allBuffers.push(...hexEntries);

    if (Object.keys(jsonObj).length > 0) {
      allBuffers.push(stringToUint8Array(JSON.stringify(jsonObj)));
    }

    return uint8ArrayToBase64(concatUint8Arrays(...allBuffers));
  }

  /**
   * Parse a V4 export string into span components.
   * Also supports V3 format by delegating to SpanComponentsV3.
   */
  static fromStr(s: string): SpanComponentsV4 {
    try {
      const rawBytes = base64ToUint8Array(s);
      const jsonObj: Record<string, unknown> = {};

      if (rawBytes[0] < ENCODING_VERSION_NUMBER_V4) {
        // Handle older versions by delegating to V3
        const v3Components = SpanComponentsV3.fromStr(s);
        jsonObj["object_type"] = v3Components.data.object_type;
        jsonObj["object_id"] = v3Components.data.object_id;
        jsonObj["compute_object_metadata_args"] =
          v3Components.data.compute_object_metadata_args;
        jsonObj["row_id"] = v3Components.data.row_id;
        jsonObj["span_id"] = v3Components.data.span_id;
        jsonObj["root_span_id"] = v3Components.data.root_span_id;
        jsonObj["propagated_event"] = v3Components.data.propagated_event;
      } else {
        // V4 binary format
        jsonObj["object_type"] = rawBytes[1];
        const numHexEntries = rawBytes[2];
        let byteOffset = 3;

        for (let i = 0; i < numHexEntries; i++) {
          const fieldId = rawBytes[byteOffset] as Fields;
          if (fieldId === Fields.SPAN_ID) {
            // 8-byte span ID
            const hexBytes = rawBytes.subarray(byteOffset + 1, byteOffset + 9);
            byteOffset += 9;
            jsonObj[FIELDS_ID_TO_NAME[fieldId]] = Array.from(hexBytes, (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
          } else if (fieldId === Fields.ROOT_SPAN_ID) {
            // 16-byte trace ID
            const hexBytes = rawBytes.subarray(byteOffset + 1, byteOffset + 17);
            byteOffset += 17;
            jsonObj[FIELDS_ID_TO_NAME[fieldId]] = Array.from(hexBytes, (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
          } else {
            // Should not happen for object_id/row_id in V4, but handle gracefully
            const hexBytes = rawBytes.subarray(byteOffset + 1, byteOffset + 17); // assume 16 bytes
            byteOffset += 17;
            jsonObj[FIELDS_ID_TO_NAME[fieldId]] = Array.from(hexBytes, (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
          }
        }

        if (byteOffset < rawBytes.length) {
          const remainingJsonObj = JSON.parse(
            uint8ArrayToString(rawBytes.subarray(byteOffset)),
          );
          Object.assign(jsonObj, remainingJsonObj);
        }
      }

      // Validate required fields
      if (typeof jsonObj.object_type !== 'number') {
        throw new Error('Missing or invalid required field: object_type');
      }
      if (typeof jsonObj.row_id !== 'string') {
        throw new Error('Missing or invalid required field: row_id');
      }
      if (typeof jsonObj.span_id !== 'string') {
        throw new Error('Missing or invalid required field: span_id');
      }
      if (typeof jsonObj.root_span_id !== 'string') {
        throw new Error('Missing or invalid required field: root_span_id');
      }

      return new SpanComponentsV4(jsonObj as unknown as SpanComponentsV4Data);
    } catch (error) {
      throw new Error(`${INVALID_ENCODING_ERRMSG_V4} Error: ${error}`);
    }
  }
}

/**
 * Type alias for SpanComponentsV4 constructor.
 */
export type SpanComponentsV4Constructor = typeof SpanComponentsV4;

