import { BraintrustState, ObjectFetcher, WithTransactionId } from "./logger";

export interface TraceOptions {
  objectType: "experiment" | "project_logs";
  objectId: string;
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
    objectType: "experiment" | "project_logs",
    private readonly _objectId: string,
    private readonly rootSpanId: string,
    private readonly _state: BraintrustState,
    private readonly spanTypeFilter?: string[],
  ) {
    // Build the filter expression for root_span_id and optionally span_attributes.type
    const filterExpr = SpanFetcher.buildFilter(rootSpanId, spanTypeFilter);

    super(objectType, undefined, undefined, {
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
    return Promise.resolve(this._objectId);
  }

  protected async getState(): Promise<BraintrustState> {
    return this._state;
  }
}

/**
 * Span data returned by getSpans().
 */
export interface SpanData {
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  span_id?: string;
  span_parents?: string[];
  span_attributes?: {
    type?: string;
    name?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Interface for trace objects that can be used by scorers.
 * Both the SDK's LocalTrace class and the API wrapper's WrapperTrace implement this.
 */
export interface Trace {
  getConfiguration(): {
    objectType: string;
    objectId: string;
    rootSpanId: string;
  };
  getSpans(options?: { spanType?: string[] }): Promise<SpanData[]>;
}

/**
 * SDK implementation of Trace that uses local span cache and falls back to BTQL.
 * Carries identifying information about the evaluation so scorers can perform
 * richer logging or side effects.
 */
export class LocalTrace implements Trace {
  // Store values privately so future helper methods can expose them safely.
  private readonly objectType: "experiment" | "project_logs";
  private readonly objectId: string;
  private readonly rootSpanId: string;
  private readonly ensureSpansFlushed?: () => Promise<void>;
  private readonly state: BraintrustState;
  private spansFlushed = false;
  private spansFlushPromise: Promise<void> | null = null;

  constructor({
    objectType,
    objectId,
    rootSpanId,
    ensureSpansFlushed,
    state,
  }: TraceOptions) {
    this.objectType = objectType;
    this.objectId = objectId;
    this.rootSpanId = rootSpanId;
    this.ensureSpansFlushed = ensureSpansFlushed;
    this.state = state;
  }

  getConfiguration() {
    return {
      objectType: this.objectType,
      objectId: this.objectId,
      rootSpanId: this.rootSpanId,
    };
  }

  /**
   * Fetch all rows for this root span from its parent object (experiment or project logs).
   * First checks the local span cache for recently logged spans, then falls
   * back to BTQL API if not found in cache.
   */
  async getSpans({ spanType }: { spanType?: string[] } = {}): Promise<
    SpanData[]
  > {
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
      this.objectType,
      this.objectId,
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
