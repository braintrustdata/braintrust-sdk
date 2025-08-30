import { SpanType } from "@braintrust/core";
import { type EvalResult } from "./framework";

export interface ReadonlyTrace {
  readonly rootSpanId: string;

  readonly roots: ReadonlySpan[];

  /**
   * Returns all spans, in chronological order (from start time), that
   * match at least one of the provided filters.
   */
  getSpans(...filters: SpanFilter[]): ReadonlySpan[];

  kind: "readonly_trace";
}

export type SpanFilter = Partial<
  Omit<ReadonlySpan, "parent" | "children" | "kind" | "getData">
>;

export interface ReadonlySpan {
  readonly rootSpanId: string;
  readonly spanId: string;
  readonly id: string;

  readonly isRoot: boolean;
  readonly parent: ReadonlySpan | null;
  readonly children: ReadonlySpan[];

  readonly name: string;
  readonly type: SpanType;

  getData(): Promise<EvalResult<unknown, unknown, unknown>>;

  kind: "readonly_span";
}
