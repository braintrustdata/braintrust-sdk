// Mirror of core/py/src/braintrust_core/span_parent_identifier.py.

import { PARENT_ID_FIELD } from "./db_fields";
import { ParentExperimentIds, ParentProjectLogIds } from "./object";

export enum SpanParentObjectType {
  EXPERIMENT = "experiment",
  PROJECT_LOGS = "project_logs",
}

const _OBJECT_TYPE_TO_PREFIX: Record<SpanParentObjectType, string> = {
  [SpanParentObjectType.EXPERIMENT]: "ex",
  [SpanParentObjectType.PROJECT_LOGS]: "pl",
};

const _PREFIX_TO_OBJECT_TYPE = Object.fromEntries(
  Object.entries(_OBJECT_TYPE_TO_PREFIX).map(([k, v]) => [v, k])
) as Record<string, SpanParentObjectType>;

const _SEP = ":";

export type SpanParentComponentsDict = (
  | ParentExperimentIds
  | ParentProjectLogIds
) & { [PARENT_ID_FIELD]?: string };

export class SpanParentComponents {
  public objectType: SpanParentObjectType;
  public objectId: string;
  public rowId: string;

  constructor(args: {
    objectType: SpanParentObjectType;
    objectId: string;
    rowId: string;
  }) {
    this.objectType = args.objectType;
    this.objectId = args.objectId;
    this.rowId = args.rowId;

    if (!(typeof this.objectType === "string")) {
      throw new Error("objectType must be a string");
    }
    if (!(typeof this.objectId === "string")) {
      throw new Error("objectId must be a string");
    }
    if (!(typeof this.rowId === "string")) {
      throw new Error("rowId must be a string");
    }

    const objectTypePrefix = _OBJECT_TYPE_TO_PREFIX[this.objectType];
    if (objectTypePrefix.includes(_SEP)) {
      throw new Error(
        `objectType prefix ${objectTypePrefix} may not contain separator character ${_SEP}`
      );
    }
    if (this.objectId.includes(_SEP)) {
      throw new Error(
        `objectId ${this.objectId} may not contain separator character ${_SEP}`
      );
    }
  }

  public toStr(): string {
    return [
      _OBJECT_TYPE_TO_PREFIX[this.objectType],
      this.objectId,
      this.rowId,
    ].join(_SEP);
  }

  public static fromStr(s: string): SpanParentComponents {
    const items: string[] = s.split(_SEP);

    if (items.length < 3) {
      throw new Error(
        `Serialized parent components string must have at least three components. Provided string ${s} has only ${items.length}`
      );
    }

    return new SpanParentComponents({
      objectType: _PREFIX_TO_OBJECT_TYPE[items[0]],
      objectId: items[1],
      rowId: items.slice(2).join(_SEP),
    });
  }

  public asDict(): SpanParentComponentsDict {
    const out = ((): SpanParentComponentsDict => {
      switch (this.objectType) {
        case SpanParentObjectType.EXPERIMENT:
          return { experiment_id: this.objectId };
        case SpanParentObjectType.PROJECT_LOGS:
          return { project_id: this.objectId, log_id: "g" };
        default:
          throw new Error("Impossible");
      }
    })();
    if (this.rowId) {
      out[PARENT_ID_FIELD] = this.rowId;
    }
    return out;
  }
}
