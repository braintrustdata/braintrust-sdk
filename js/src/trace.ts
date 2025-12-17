import { _internalGetGlobalState } from "./logger";
import { createHash } from "node:crypto";

const MAX_FETCH_RETRIES = 8;
const INITIAL_RETRY_DELAY_MS = 250;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface TraceOptions {
  experimentId?: string;
  logsId?: string;
  rootSpanId: string;
  ensureSpansFlushed?: () => Promise<void>;
}

function isObject(value: any): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const getMessageHash = (
  message: any,
  hashCache: Map<string, string>,
): string => {
  const messageString = JSON.stringify(message);
  const hashString = createHash("md5").update(messageString).digest("hex");

  // Cache the result
  hashCache.set(messageString, hashString);
  return hashString;
};

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
  private spansFlushed = false;
  private spansFlushPromise: Promise<void> | null = null;

  constructor({
    experimentId,
    logsId,
    rootSpanId,
    ensureSpansFlushed,
  }: TraceOptions) {
    this.experimentId = experimentId;
    this.logsId = logsId;
    this.rootSpanId = rootSpanId;
    this.ensureSpansFlushed = ensureSpansFlushed;
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

    const state = _internalGetGlobalState();
    if (!state) {
      return [];
    }

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

    // Cache miss - fall back to BTQL
    await this.ensureSpansReady();

    await state.login({});

    const query = `
      from: experiment('${this.experimentId}')
      | filter: root_span_id = '${this.rootSpanId}' ${spanType ? `AND span_attributes.type IN ${JSON.stringify(spanType)}` : ""}
      | select: *
      | sort: _xact_id asc
    `;

    for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt++) {
      const response = await state.apiConn().post(
        "btql",
        {
          query,
          use_columnstore: true,
          brainstore_realtime: true,
        },
        { headers: { "Accept-Encoding": "gzip" } },
      );

      const payload = await response.json();
      const rows = payload?.data ?? [];
      const freshness = payload?.freshness_state;
      const isFresh =
        freshness?.last_processed_xact_id != null &&
        freshness?.last_processed_xact_id ===
          freshness?.last_considered_xact_id;

      if ((rows.length > 0 && isFresh) || attempt === MAX_FETCH_RETRIES - 1) {
        return rows
          .filter((row: any) => row.span_attributes?.type !== "score")
          .map((row: any) => ({
            input: row.input,
            output: row.output,
            metadata: row.metadata,
            span_id: row.span_id,
            span_parents: row.span_parents,
            span_attributes: row.span_attributes,
          }));
      }

      const backoff =
        INITIAL_RETRY_DELAY_MS * Math.pow(2, Math.min(attempt, 3));
      await sleep(backoff);
    }

    return [];
  }

  /**
   * Fetch the thread of messages for this trace.
   *
   * @experimental This method is experimental and may change in the future.
   */
  async getThread() {
    const spans = await this.getSpans({ spanType: ["llm"] });
    const hashCache = new Map<string, string>();
    const messages: any[] = [];
    const hashes = new Set<string>();
    const addMessage = (
      rawMessage: any,
      { skipDedupe = false }: { skipDedupe?: boolean } = {},
    ) => {
      if (!isObject(rawMessage)) {
        return;
      }
      const message = { ...rawMessage };
      const messageHash = getMessageHash(message, hashCache);
      if (!skipDedupe && hashes.has(messageHash)) {
        return;
      }
      messages.push(message);
      hashes.add(messageHash);
    };
    for (const span of spans) {
      if (span.input instanceof Array) {
        for (const message of span.input) {
          addMessage(message);
        }
      } else if (isObject(span.input)) {
        addMessage(span.input);
      } else if (typeof span.input === "string") {
        addMessage({ role: "user", content: span.input });
      }

      // Always include outputs
      if (span.output instanceof Array) {
        for (const message of span.output) {
          addMessage(message, { skipDedupe: true });
        }
      } else if (isObject(span.output)) {
        addMessage(span.output, { skipDedupe: true });
      } else if (typeof span.output === "string") {
        addMessage(
          { role: "assistant", content: span.output },
          { skipDedupe: true },
        );
      }
    }
    return messages;
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
