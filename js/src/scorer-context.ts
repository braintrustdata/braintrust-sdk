import { _internalGetGlobalState } from "./logger";

const MAX_FETCH_RETRIES = 8;
const INITIAL_RETRY_DELAY_MS = 250;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface ScorerContextOptions {
  experimentId?: string;
  logsId?: string;
  rootSpanId: string;
}

/**
 * Carries identifying information about the evaluation so scorers can perform
 * richer logging or side effects. Additional behavior will be layered on top
 * of this skeleton class later.
 */
export class ScorerContext {
  // Store values privately so future helper methods can expose them safely.
  private readonly experimentId?: string;
  private readonly logsId?: string;
  private readonly rootSpanId: string;

  constructor({ experimentId, logsId, rootSpanId }: ScorerContextOptions) {
    this.experimentId = experimentId;
    this.logsId = logsId;
    this.rootSpanId = rootSpanId;
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
   */
  async getSpans({ spanType }: { spanType: string }): Promise<any[]> {
    if (!this.experimentId) {
      return [];
    }

    const state = _internalGetGlobalState();
    if (!state) {
      return [];
    }

    await state.login({});

    const query = `
      from: experiment('${this.experimentId}')
      | filter: root_span_id = '${this.rootSpanId}' ${spanType ? `AND span_attributes.type = '${spanType}'` : ""}
      | select: *
    `;

    for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt++) {
      const response = await state.apiConn().post(
        "btql",
        {
          query,
          use_columnstore: false,
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
}
