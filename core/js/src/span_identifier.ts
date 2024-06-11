// Mirror of core/py/src/braintrust_core/span_parent_identifier.py.

import * as uuid from "uuid";
import { ParentExperimentIds, ParentProjectLogIds } from "./object";
import { z } from "zod";

function tryMakeUuid(s: string): { bytes: Buffer; isUUID: boolean } {
  try {
    const ret = uuid.parse(s);
    if (ret.length !== 16) {
      throw new Error();
    }
    return { bytes: Buffer.from(ret), isUUID: true };
  } catch (e) {
    return { bytes: Buffer.from(s, "utf-8"), isUUID: false };
  }
}

const ENCODING_VERSION_NUMBER = 2;

const INVALID_ENCODING_ERRMSG =
  "SpanComponents string is not properly encoded. This may be due to a version mismatch between the SDK library used to export the span and the library used to decode it. Please make sure you are using the same SDK version across the board";
// If you change this, make sure to change the method used to read/write integer
// bytes to a buffer, from writeInt32BE.
const INTEGER_ENCODING_NUM_BYTES = 4;

export enum SpanObjectType {
  EXPERIMENT = 0,
  PROJECT_LOGS = 1,
}

const SpanObjectTypeEnumSchema = z.nativeEnum(SpanObjectType);

export class SpanRowIds {
  public rowId: string;
  public spanId: string;
  public rootSpanId: string;

  constructor(args: { rowId: string; spanId: string; rootSpanId: string }) {
    this.rowId = args.rowId;
    this.spanId = args.spanId;
    this.rootSpanId = args.rootSpanId;

    if (!this.rowId) {
      throw new Error("rowId must be nonempty string");
    }
    if (!this.spanId) {
      throw new Error("spanId must be nonempty string");
    }
    if (!this.rootSpanId) {
      throw new Error("rootSpanId must be nonempty string");
    }
  }

  public toObject() {
    return {
      rowId: this.rowId,
      spanId: this.spanId,
      rootSpanId: this.rootSpanId,
    };
  }
}

export class SpanComponents {
  public objectType: SpanObjectType;
  public objectId: string | undefined;
  public computeObjectMetadataArgs: Record<string, any> | undefined;
  public rowIds: SpanRowIds | undefined;

  constructor(args: {
    objectType: SpanObjectType;
    objectId?: string;
    computeObjectMetadataArgs?: Record<string, any>;
    rowIds?: SpanRowIds;
  }) {
    this.objectType = args.objectType;
    this.objectId = args.objectId;
    this.computeObjectMetadataArgs = args.computeObjectMetadataArgs;
    this.rowIds = args.rowIds;

    if (!(this.objectId || this.computeObjectMetadataArgs)) {
      throw new Error(
        "Must provide either objectId or computeObjectMetadataArgs",
      );
    }
  }

  public toStr(): string {
    const allBuffers: Array<Buffer> = [];

    const { bytes: rowIdBytes, isUUID: rowIdIsUUID } = this.rowIds
      ? tryMakeUuid(this.rowIds.rowId)
      : { bytes: Buffer.from(""), isUUID: false };

    allBuffers.push(
      Buffer.from([
        ENCODING_VERSION_NUMBER,
        this.objectType,
        this.objectId ? 1 : 0,
        this.computeObjectMetadataArgs ? 1 : 0,
        this.rowIds ? 1 : 0,
        rowIdIsUUID ? 1 : 0,
      ]),
    );

    if (this.objectId) {
      const { bytes: objectIdBytes, isUUID: objectIdIsUUID } = tryMakeUuid(
        this.objectId,
      );
      if (!objectIdIsUUID) {
        throw new Error("object_id component must be a valid UUID");
      }
      allBuffers.push(objectIdBytes);
    }

    if (this.computeObjectMetadataArgs) {
      const computeObjectMetadataBytes = Buffer.from(
        JSON.stringify(this.computeObjectMetadataArgs),
        "utf-8",
      );
      const serializedLenBytes = Buffer.alloc(INTEGER_ENCODING_NUM_BYTES);
      serializedLenBytes.writeInt32BE(computeObjectMetadataBytes.length);
      allBuffers.push(serializedLenBytes, computeObjectMetadataBytes);
    }

    if (this.rowIds) {
      const { bytes: spanIdBytes, isUUID: spanIdIsUUID } = tryMakeUuid(
        this.rowIds.spanId,
      );
      if (!spanIdIsUUID) {
        throw new Error("span_id component must be a valid UUID");
      }
      const { bytes: rootSpanIdBytes, isUUID: rootSpanIdIsUUID } = tryMakeUuid(
        this.rowIds.rootSpanId,
      );
      if (!rootSpanIdIsUUID) {
        throw new Error("root_span_id component must be a valid UUID");
      }
      allBuffers.push(spanIdBytes, rootSpanIdBytes, rowIdBytes);
    }

    return Buffer.concat(allBuffers).toString("base64");
  }

  public static fromStr(s: string): SpanComponents {
    try {
      const rawBytes = Buffer.from(s, "base64");
      if (rawBytes[0] !== ENCODING_VERSION_NUMBER) {
        throw new Error();
      }
      const objectType = SpanObjectTypeEnumSchema.parse(rawBytes[1]);
      for (let i = 2; i < 6; ++i) {
        if (![0, 1].includes(rawBytes[i])) {
          throw new Error();
        }
      }
      const hasObjectId = rawBytes[2] == 1;
      const hasComputeObjectMetadataArgs = rawBytes[3] == 1;
      const hasRowId = rawBytes[4] == 1;
      const rowIdIsUUID = rawBytes[5] == 1;

      let byteCursor = 6;
      let objectId: string | undefined = undefined;
      if (hasObjectId) {
        const nextByteCursor = byteCursor + 16;
        objectId = uuid.stringify(
          rawBytes.subarray(byteCursor, nextByteCursor),
        );
        byteCursor = nextByteCursor;
      }

      let computeObjectMetadataArgs: Record<string, any> | undefined;
      if (hasComputeObjectMetadataArgs) {
        let nextByteCursor = byteCursor + INTEGER_ENCODING_NUM_BYTES;
        const serializedLenBytes = rawBytes.readInt32BE(byteCursor);
        byteCursor = nextByteCursor;
        nextByteCursor = byteCursor + serializedLenBytes;
        computeObjectMetadataArgs = JSON.parse(
          rawBytes.subarray(byteCursor, nextByteCursor).toString("utf-8"),
        );
        byteCursor = nextByteCursor;
      }

      const rowIds = (() => {
        if (!hasRowId) {
          return undefined;
        }
        let nextByteCursor = byteCursor + 16;
        const spanId = uuid.stringify(
          rawBytes.subarray(byteCursor, nextByteCursor),
        );
        byteCursor = nextByteCursor;
        nextByteCursor = byteCursor + 16;
        const rootSpanId = uuid.stringify(
          rawBytes.subarray(byteCursor, nextByteCursor),
        );
        byteCursor = nextByteCursor;
        const rowId = rowIdIsUUID
          ? uuid.stringify(rawBytes.subarray(byteCursor))
          : rawBytes.subarray(byteCursor).toString("utf-8");
        return new SpanRowIds({ rowId, spanId, rootSpanId });
      })();

      return new SpanComponents({
        objectType,
        objectId,
        computeObjectMetadataArgs,
        rowIds,
      });
    } catch (e) {
      throw new Error(INVALID_ENCODING_ERRMSG);
    }
  }

  public objectIdFields(): ParentExperimentIds | ParentProjectLogIds {
    if (!this.objectId) {
      throw new Error(
        "Impossible: cannot invoke `object_id_fields` unless SpanComponents is initialized with an `object_id`",
      );
    }
    switch (this.objectType) {
      case SpanObjectType.EXPERIMENT:
        return { experiment_id: this.objectId };
      case SpanObjectType.PROJECT_LOGS:
        return { project_id: this.objectId, log_id: "g" };
      default:
        throw new Error("Impossible");
    }
  }

  public toObject() {
    return {
      objectType: this.objectType,
      objectId: this.objectId,
      computeObjectMetadataArgs: this.computeObjectMetadataArgs,
      rowIds: this.rowIds?.toObject(),
    };
  }
}
