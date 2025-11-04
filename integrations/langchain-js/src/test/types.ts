type SpanAttributes = {
  name: string;
  exec_counter: number;
  type?: string;
};

type Metadata = {
  tags: string[];
  params: Record<string, unknown>;
  [key: string]: unknown;
};

type Output = {
  parsed: string;
  raw: Record<string, unknown>;
};

type LogRow = {
  span_attributes?: SpanAttributes;
  input?: Record<string, unknown>;
  metadata?: Metadata;
  output?: Output;
  span_id: string;
  root_span_id: string;
  span_parents: string[];
};

export type LogsRequest = {
  rows: LogRow[];
  api_version: number;
};
