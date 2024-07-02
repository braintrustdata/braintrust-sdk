// Mirror of the functions in core/py/src/braintrust_core/merge_row_batch.py.

import { IS_MERGE_FIELD, PARENT_ID_FIELD } from "./db_fields";
import { mapAt, mergeDicts } from "./util";
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

export function mergeRowBatch<
  T extends {
    id: string;
    [IS_MERGE_FIELD]?: boolean | null;
    [PARENT_ID_FIELD]?: string | null;
  },
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
      const preserveNoMerge = !existingRow[IS_MERGE_FIELD];
      mergeDicts(existingRow, row);
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
