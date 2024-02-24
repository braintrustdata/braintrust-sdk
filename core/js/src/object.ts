import {
  IS_MERGE_FIELD,
  MERGE_PATHS_FIELD,
  PARENT_ID_FIELD,
  Source,
  AUDIT_SOURCE_FIELD,
  AUDIT_METADATA_FIELD,
} from "./db_fields";

export type IdField = { id: string };
export type InputField = { input: unknown };
export type InputsField = { inputs: unknown };
export type OtherExperimentLogFields = {
  output: unknown;
  expected: unknown;
  scores: Record<string, number | null>;
  metadata: Record<string, unknown>;
  metrics: Record<string, unknown>;
  datasetRecordId: string;
};

export type ExperimentLogPartialArgs = Partial<OtherExperimentLogFields> &
  Partial<InputField | InputsField>;

export type ExperimentLogFullArgs = Partial<
  Omit<OtherExperimentLogFields, "output" | "scores">
> &
  Required<Pick<OtherExperimentLogFields, "output" | "scores">> &
  Partial<InputField | InputsField> &
  Partial<IdField>;

export type LogFeedbackFullArgs = IdField &
  Partial<
    Omit<OtherExperimentLogFields, "output" | "metrics" | "datasetRecordId"> & {
      comment: string;
      source: Source;
    }
  >;

export interface ParentExperimentIds {
  kind: "experiment";
  project_id: string;
  experiment_id: string;
}

export interface ParentProjectLogIds {
  kind: "project_log";
  org_id: string;
  project_id: string;
  log_id: "g";
}

export type LogCommentFullArgs = IdField & {
  created: string;
  origin: {
    id: string;
  };
  comment: {
    text: string;
  };
  [AUDIT_SOURCE_FIELD]: Source;
  [AUDIT_METADATA_FIELD]?: Record<string, unknown>;
} & Omit<ParentExperimentIds | ParentProjectLogIds, "kind">;

export type SanitizedExperimentLogPartialArgs =
  Partial<OtherExperimentLogFields> & Partial<InputField>;

export type ExperimentEvent = Partial<InputField> &
  Partial<OtherExperimentLogFields> & {
    id: string;
    span_id?: string;
    root_span_id?: string;
    project_id: string;
    experiment_id: string;
    [IS_MERGE_FIELD]: boolean;
  } & Partial<{
    created: string;
    span_parents: string[];
    span_attributes: Record<string, unknown>;
    context: Record<string, unknown>;
    [PARENT_ID_FIELD]: string;
    [AUDIT_SOURCE_FIELD]: Source;
    [AUDIT_METADATA_FIELD]?: Record<string, unknown>;
  }>;

export type DatasetEvent = {
  input?: unknown;
  metadata?: unknown;
  id: string;
  project_id: string;
  dataset_id: string;
  created: string;
} & ({ expected?: unknown } | { output?: unknown });

export type LoggingEvent = Omit<ExperimentEvent, "experiment_id"> & {
  org_id: string;
  log_id: "g";
};

export type CommentEvent = IdField & {
  created: string;
  origin: {
    id: string;
  };
  comment: {
    text: string;
  };
  [AUDIT_SOURCE_FIELD]: Source;
  [AUDIT_METADATA_FIELD]?: Record<string, unknown>;
} & Omit<ParentExperimentIds | ParentProjectLogIds, "kind">;

export type BackgroundLogEvent =
  | ExperimentEvent
  | DatasetEvent
  | LoggingEvent
  | CommentEvent;

export const DEFAULT_IS_LEGACY_DATASET = true;

interface LegacyDatasetRecord {
  id: string;
  input: any;
  output: any;
  metadata: any;
}

interface NewDatasetRecord {
  id: string;
  input: any;
  expected: any;
  metadata: any;
}

export type DatasetRecord<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET
> = IsLegacyDataset extends true ? LegacyDatasetRecord : NewDatasetRecord;

export type AnyDatasetRecord = DatasetRecord<boolean>;

export function ensureDatasetRecord<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET
>(
  r: AnyDatasetRecord,
  legacy: IsLegacyDataset
): DatasetRecord<IsLegacyDataset> {
  if (legacy) {
    return ensureLegacyDatasetRecord(r) as DatasetRecord<IsLegacyDataset>;
  } else {
    return ensureNewDatasetRecord(r) as DatasetRecord<IsLegacyDataset>;
  }
}

export function ensureLegacyDatasetRecord(
  r: AnyDatasetRecord
): DatasetRecord<true> {
  if ("output" in r) {
    return r;
  }
  const row = {
    ...r,
    output: r.expected,
  };
  delete row.expected;
  return row;
}

export function ensureNewDatasetRecord(
  r: AnyDatasetRecord
): DatasetRecord<false> {
  if ("expected" in r) {
    return r;
  }
  const row = {
    ...r,
    expected: r.output,
  };
  delete row.output;
  return row;
}

export function makeLegacyEvent(e: BackgroundLogEvent): BackgroundLogEvent {
  if (!("dataset_id" in e) || !("expected" in e)) {
    return e;
  }

  const event = {
    ...e,
    output: e.expected,
  };
  delete event.expected;

  if (MERGE_PATHS_FIELD in event) {
    for (const path of (event[MERGE_PATHS_FIELD] || []) as string[][]) {
      if (path.length > 0 && path[0] === "expected") {
        path[0] = "output";
      }
    }
  }

  return event;
}
