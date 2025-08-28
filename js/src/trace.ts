import { SpanType } from "@braintrust/core";

export interface ReadonlyTrace {
  readonly rootSpanId: string;

  readonly roots: ReadonlySpan[];

  /**
   * Returns all spans, in chronological order (from start time), that
   * match at least one of the provided filters.
   */
  findSpans(filters: SpanFilter[]): ReadonlySpan[];

  kind: "readonly_trace";
}

export type SpanFilter = Partial<
  Omit<ReadonlySpan, "parent" | "children" | "kind">
>;

export interface ReadonlySpan {
  readonly rootSpanId: string;
  readonly spanId: string;
  readonly id: string;

  readonly isRoot: boolean;
  readonly parent: ReadonlySpan;
  readonly children: ReadonlySpan[];

  readonly name: string;
  readonly type: SpanType;

  readonly input: unknown;
  readonly output: unknown;
  readonly expected: unknown;
  readonly metadata: Record<string, unknown> | null | undefined;
  readonly scores: Record<string, number>;
  readonly metrics: Record<string, number>;

  kind: "readonly_span";
}
