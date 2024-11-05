import { z } from "zod";
import {
  AsyncScoringControl,
  objectReferenceSchema,
} from "../typespecs/api_types";
import {
  Source,
  ASYNC_SCORING_CONTROL_FIELD,
  AUDIT_METADATA_FIELD,
  AUDIT_SOURCE_FIELD,
  IS_MERGE_FIELD,
  MERGE_PATHS_FIELD,
  PARENT_ID_FIELD,
  SKIP_ASYNC_SCORING_FIELD,
} from "./db_fields";

export type IdField = { id: string };
export type InputField = { input: unknown };
export type OtherExperimentLogFields = {
  output: unknown;
  expected: unknown;
  error: unknown;
  tags: string[];
  scores: Record<string, number | null>;
  metadata: Record<string, unknown>;
  metrics: Record<string, unknown>;
  datasetRecordId: string;
  origin: z.infer<typeof objectReferenceSchema>;
  [ASYNC_SCORING_CONTROL_FIELD]: AsyncScoringControl;
  [MERGE_PATHS_FIELD]: string[][];
  [SKIP_ASYNC_SCORING_FIELD]: boolean;
};

export type ExperimentLogPartialArgs = Partial<OtherExperimentLogFields> &
  Partial<InputField>;

export type ExperimentLogFullArgs = Partial<
  Omit<OtherExperimentLogFields, "output" | "scores">
> &
  Required<Pick<OtherExperimentLogFields, "output" | "scores">> &
  Partial<InputField> &
  Partial<IdField>;

export type LogFeedbackFullArgs = IdField &
  Partial<
    Omit<OtherExperimentLogFields, "output" | "metrics" | "datasetRecordId"> & {
      comment: string;
      source: Source;
    }
  >;

export interface ParentExperimentIds {
  experiment_id: string;
}

export interface ParentProjectLogIds {
  project_id: string;
  log_id: "g";
}

export interface ParentPromptSessionIds {
  prompt_session_id: string;
  log_id: "x";
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
} & (ParentExperimentIds | ParentProjectLogIds);

export type SanitizedExperimentLogPartialArgs =
  Partial<OtherExperimentLogFields> & Partial<InputField>;

export type ExperimentEvent = Partial<InputField> &
  Partial<OtherExperimentLogFields> & {
    id: string;
    span_id?: string;
    root_span_id?: string;
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
  tags?: string[];
  metadata?: unknown;
  created?: string;
  id: string;
  dataset_id: string;
} & ({ expected?: unknown } | { output?: unknown });

export type LoggingEvent = Omit<ExperimentEvent, "experiment_id"> & {
  project_id: string;
  log_id: "g";
};

export type PromptSessionLogEvent = Omit<ExperimentEvent, "experiment_id"> & {
  prompt_session_id: string;
  log_id: "x";
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
} & (ParentExperimentIds | ParentProjectLogIds | ParentPromptSessionIds);

export type BackgroundLogEvent =
  | ExperimentEvent
  | DatasetEvent
  | LoggingEvent
  | PromptSessionLogEvent
  | CommentEvent;

export const DEFAULT_IS_LEGACY_DATASET = false;

interface LegacyDatasetRecord {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: any;
}

interface NewDatasetRecord {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expected: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tags: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: any;
}

export type DatasetRecord<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET,
> = IsLegacyDataset extends true ? LegacyDatasetRecord : NewDatasetRecord;

export type AnyDatasetRecord = DatasetRecord<boolean>;

export function ensureDatasetRecord<
  IsLegacyDataset extends boolean = typeof DEFAULT_IS_LEGACY_DATASET,
>(
  r: AnyDatasetRecord,
  legacy: IsLegacyDataset,
): DatasetRecord<IsLegacyDataset> {
  if (legacy) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ensureLegacyDatasetRecord(r) as DatasetRecord<IsLegacyDataset>;
  } else {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ensureNewDatasetRecord(r) as DatasetRecord<IsLegacyDataset>;
  }
}

export function ensureLegacyDatasetRecord(
  r: AnyDatasetRecord,
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
  r: AnyDatasetRecord,
): DatasetRecord<false> {
  if ("expected" in r) {
    return r;
  }
  const row = {
    ...r,
    tags: null,
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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    for (const path of (event[MERGE_PATHS_FIELD] || []) as string[][]) {
      if (path.length > 0 && path[0] === "expected") {
        path[0] = "output";
      }
    }
  }

  return event;
}
