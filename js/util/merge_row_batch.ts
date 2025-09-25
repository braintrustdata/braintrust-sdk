// Mirror of the functions in py/src/braintrust/merge_row_batch.py.

import { IS_MERGE_FIELD, PARENT_ID_FIELD } from "./db_fields";
import { mapAt, mergeDicts } from "./object_util";
import {
  AdjacencyListGraph,
  undirectedConnectedComponents,
  topologicalSort,
} from "./graph_util";

function generateMergedRowKey(
  row: Record<string, unknown>,
  useParentIdForId?: boolean,
) {
  return JSON.stringify(
    [
      "org_id",
      "project_id",
      "experiment_id",
      "dataset_id",
      "prompt_session_id",
      "log_id",
      useParentIdForId ?? false ? PARENT_ID_FIELD : "id",
    ].map((k) => row[k]),
  );
}

// These fields will be retained as-is when merging rows.
const MERGE_ROW_SKIP_FIELDS = [
  "created",
  "span_id",
  "root_span_id",
  "span_parents",
  "_parent_id",
  // TODO: handle merge paths.
] as const;
type MergeRowSkipField = (typeof MERGE_ROW_SKIP_FIELDS)[number];
type MergeRowSkipFieldObj = { [K in MergeRowSkipField]?: unknown };

function popMergeRowSkipFields<T extends MergeRowSkipFieldObj>(
  row: T,
): MergeRowSkipFieldObj {
  const popped: MergeRowSkipFieldObj = {};
  for (const field of MERGE_ROW_SKIP_FIELDS) {
    if (field in row) {
      popped[field] = row[field];
      delete row[field];
    }
  }
  return popped;
}

function restoreMergeRowSkipFields<T extends MergeRowSkipFieldObj>(
  row: T,
  skipFields: MergeRowSkipFieldObj,
) {
  for (const field of MERGE_ROW_SKIP_FIELDS) {
    delete row[field];
    if (field in skipFields) {
      row[field] = skipFields[field];
    }
  }
}

export function mergeRowBatch<
  T extends {
    id: string;
    [IS_MERGE_FIELD]?: boolean | null;
    [PARENT_ID_FIELD]?: string | null;
  } & MergeRowSkipFieldObj,
>(rows: T[]): T[][] {
  for (const row of rows) {
    if (row.id === undefined) {
      throw new Error(
        "Logged row is missing an id. This is an internal braintrust error. Please contact us at info@braintrust.dev for help",
      );
    }
  }

  const rowGroups: Map<string, T> = new Map();
  for (const row of rows) {
    const key = generateMergedRowKey(row);
    const existingRow = rowGroups.get(key);
    if (existingRow !== undefined && row[IS_MERGE_FIELD]) {
      const skipFields = popMergeRowSkipFields(existingRow);
      const preserveNoMerge = !existingRow[IS_MERGE_FIELD];
      mergeDicts(existingRow, row);
      restoreMergeRowSkipFields(existingRow, skipFields);
      if (preserveNoMerge) {
        delete existingRow[IS_MERGE_FIELD];
      }
    } else {
      rowGroups.set(key, row);
    }
  }

  const merged = [...rowGroups.values()];
  const rowToLabel = new Map<string, number>(
    merged.map((r, i) => [generateMergedRowKey(r), i]),
  );

  const graph: AdjacencyListGraph = new Map(
    Array.from({ length: merged.length }).map((_, i) => [i, new Set()]),
  );
  merged.forEach((r, i) => {
    const parentId = r[PARENT_ID_FIELD];
    if (!parentId) {
      return;
    }
    const parentRowKey = generateMergedRowKey(r, true /* useParentIdForId */);
    const parentLabel = rowToLabel.get(parentRowKey);
    if (parentLabel !== undefined) {
      mapAt(graph, parentLabel).add(i);
    }
  });

  const connectedComponents = undirectedConnectedComponents({
    vertices: new Set(graph.keys()),
    edges: new Set(
      [...graph.entries()].flatMap(([k, vs]) =>
        [...vs].map((v) => {
          const ret: [number, number] = [k, v];
          return ret;
        }),
      ),
    ),
  });
  const buckets = connectedComponents.map((cc) =>
    topologicalSort(graph, cc /* visitationOrder */),
  );
  return buckets.map((bucket) => bucket.map((i) => merged[i]));
}

export function batchItems(args: {
  items: string[][];
  batchMaxNumItems?: number;
  batchMaxNumBytes?: number;
}): string[][][] {
  let { items } = args;
  const batchMaxNumItems = args.batchMaxNumItems ?? Number.POSITIVE_INFINITY;
  const batchMaxNumBytes = args.batchMaxNumBytes ?? Number.POSITIVE_INFINITY;

  const output: string[][][] = [];
  let nextItems: string[][] = [];
  let batchSet: string[][] = [];
  let batch: string[] = [];
  let batchLen = 0;

  function addToBatch(item: string) {
    batch.push(item);
    batchLen += item.length;
  }

  function flushBatch() {
    batchSet.push(batch);
    batch = [];
    batchLen = 0;
  }

  while (items.length) {
    for (const bucket of items) {
      let i = 0;
      for (const item of bucket) {
        if (
          batch.length === 0 ||
          (item.length + batchLen < batchMaxNumBytes &&
            batch.length < batchMaxNumItems)
        ) {
          addToBatch(item);
        } else if (i === 0) {
          flushBatch();
          addToBatch(item);
        } else {
          break;
        }
        ++i;
      }
      if (i < bucket.length) {
        nextItems.push(bucket.slice(i));
      }
      if (batchLen >= batchMaxNumBytes || batch.length > batchMaxNumItems) {
        flushBatch();
      }
    }

    if (batch.length) {
      flushBatch();
    }
    if (batchSet.length) {
      output.push(batchSet);
      batchSet = [];
    }
    items = nextItems;
    nextItems = [];
  }

  return output;
}
