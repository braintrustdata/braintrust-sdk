import { initDataset, type Dataset } from "../../logger";

export interface DatasetOptions {
  project: string;
  dataset: string;
  version?: string;
  description?: string;
}

export interface DatasetRecord {
  id: string;
  input: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export async function loadDataset(
  options: DatasetOptions | Dataset,
): Promise<DatasetRecord[]> {
  const dataset =
    "fetch" in options ? options : initDataset(options as DatasetOptions);

  const records: DatasetRecord[] = [];
  for await (const record of dataset) {
    records.push({
      id: record.id,
      input: record.input,
      expected: record.expected,
      metadata: record.metadata,
      tags: record.tags,
    });
  }

  return records;
}
