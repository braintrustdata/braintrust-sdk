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
