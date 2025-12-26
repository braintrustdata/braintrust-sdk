import { BraintrustState, ObjectFetcher, WithTransactionId } from "./logger";

export interface TraceOptions {
  experimentId?: string;
  logsId?: string;
  rootSpanId: string;
  ensureSpansFlushed?: () => Promise<void>;
  state: BraintrustState;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpanRecord = any;

/**
 * Internal fetcher for spans by root_span_id, using the ObjectFetcher pattern.
 */
class SpanFetcher extends ObjectFetcher<SpanRecord> {
  constructor(
    private readonly experimentId: string,
    private readonly rootSpanId: string,
    private readonly _state: BraintrustState,
    private readonly spanTypeFilter?: string[],
  ) {
    // Build the filter expression for root_span_id and optionally span_attributes.type
    const filterExpr = SpanFetcher.buildFilter(rootSpanId, spanTypeFilter);

    super("experiment", undefined, undefined, {
      filter: filterExpr,
      order_by: [{ expr: { op: "ident", name: ["_xact_id"] }, asc: true }],
    });
  }

  private static buildFilter(
    rootSpanId: string,
    spanTypeFilter?: string[],
  ): Record<string, unknown> {
    // Base filter: root_span_id = 'value'
    const rootSpanFilter = {
      op: "eq",
      left: { op: "ident", name: ["root_span_id"] },
      right: { op: "literal", value: rootSpanId },
    };

    // If no spanType filter, just return root_span_id filter
    if (!spanTypeFilter || spanTypeFilter.length === 0) {
      return rootSpanFilter;
    }

    // Add span_attributes.type IN [...] filter
    const spanTypeInFilter = {
      op: "in",
      left: { op: "ident", name: ["span_attributes", "type"] },
      right: spanTypeFilter.map((t) => ({ op: "literal", value: t })),
    };

    // Combine with AND
    return {
      op: "and",
      left: rootSpanFilter,
      right: spanTypeInFilter,
    };
  }

  public get id(): Promise<string> {
    return Promise.resolve(this.experimentId);
  }

  protected async getState(): Promise<BraintrustState> {
    return this._state;
  }
}

/**
 * Carries identifying information about the evaluation so scorers can perform
 * richer logging or side effects. Additional behavior will be layered on top
 * of this skeleton class later.
 */
export class Trace {
  // Store values privately so future helper methods can expose them safely.
  private readonly experimentId?: string;
  private readonly logsId?: string;
  private readonly rootSpanId: string;
  private readonly ensureSpansFlushed?: () => Promise<void>;
  private readonly state: BraintrustState;
  private spansFlushed = false;
  private spansFlushPromise: Promise<void> | null = null;

  constructor({
    experimentId,
    logsId,
    rootSpanId,
    ensureSpansFlushed,
    state,
  }: TraceOptions) {
    this.experimentId = experimentId;
    this.logsId = logsId;
    this.rootSpanId = rootSpanId;
    this.ensureSpansFlushed = ensureSpansFlushed;
    this.state = state;
  }

  getConfiguration() {
    return {
      experimentId: this.experimentId,
      logsId: this.logsId,
      rootSpanId: this.rootSpanId,
    };
  }

  /**
   * Fetch all rows for this root span from its parent experiment.
   * Returns an empty array when no experiment is associated with the context.
   *
   * First checks the local span cache for recently logged spans, then falls
   * back to BTQL API if not found in cache.
   */
  async getSpans({ spanType }: { spanType?: string[] } = {}): Promise<any[]> {
    if (!this.experimentId) {
      return [];
    }

    const state = this.state;

    // Try local cache first
    const cachedSpans = state.spanCache.getByRootSpanId(this.rootSpanId);
    if (cachedSpans && cachedSpans.length > 0) {
      let spans = cachedSpans.filter(
        (span) => span.span_attributes?.type !== "score",
      );

      // Apply spanType filter if specified
      if (spanType && spanType.length > 0) {
        spans = spans.filter((span) =>
          spanType.includes(span.span_attributes?.type ?? ""),
        );
      }

      return spans.map((span) => ({
        input: span.input,
        output: span.output,
        metadata: span.metadata,
        span_id: span.span_id,
        span_parents: span.span_parents,
        span_attributes: span.span_attributes,
      }));
    }

    // Cache miss - fall back to BTQL via ObjectFetcher pattern
    await this.ensureSpansReady();
    await state.login({});

    const fetcher = new SpanFetcher(
      this.experimentId,
      this.rootSpanId,
      state,
      spanType,
    );

    const rows: WithTransactionId<SpanRecord>[] = await fetcher.fetchedData();

    return rows
      .filter((row) => row.span_attributes?.type !== "score")
      .map((row) => ({
        input: row.input,
        output: row.output,
        metadata: row.metadata,
        span_id: row.span_id,
        span_parents: row.span_parents,
        span_attributes: row.span_attributes,
      }));
  }

  private async ensureSpansReady() {
    if (this.spansFlushed || !this.ensureSpansFlushed) {
      return;
    }

    if (!this.spansFlushPromise) {
      this.spansFlushPromise = this.ensureSpansFlushed().then(
        () => {
          this.spansFlushed = true;
        },
        (err) => {
          this.spansFlushPromise = null;
          throw err;
        },
      );
    }

    await this.spansFlushPromise;
  }
}
