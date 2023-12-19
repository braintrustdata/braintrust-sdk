import { IS_MERGE_FIELD } from "./db_fields";
import { mergeDicts } from "./util";

function generateMergedRowKey(row: Record<string, unknown>) {
  return JSON.stringify(
    [
      "org_id",
      "project_id",
      "experiment_id",
      "dataset_id",
      "prompt_session_id",
      "log_id",
      "id",
    ].map((k) => row[k])
  );
}

// Mirror of core/py/src/braintrust_core/merge_row_batch.py:merge_row_batch.
export function mergeRowBatch<
  T extends { id: string; [IS_MERGE_FIELD]?: boolean }
>(rows: T[]): T[] {
  const out: T[] = [];
  const remainingRows: T[] = [];
  // First add any rows with no ID to `out`, since they will always be
  // independent.
  for (const row of rows) {
    if (row.id === undefined) {
      out.push(row);
    } else {
      remainingRows.push(row);
    }
  }
  const rowGroups: Record<string, T> = {};
  for (const row of remainingRows) {
    const key = generateMergedRowKey(row);
    const existingRow = rowGroups[key];
    if (existingRow !== undefined && row[IS_MERGE_FIELD]) {
      const preserveNoMerge = !existingRow[IS_MERGE_FIELD];
      mergeDicts(existingRow, row);
      if (preserveNoMerge) {
        delete existingRow[IS_MERGE_FIELD];
      }
    } else {
      rowGroups[key] = row;
    }
  }
  out.push(...Object.values(rowGroups));
  return out;
}
