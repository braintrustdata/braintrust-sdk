import type { Span } from "../../logger";
import type { ScorerFunction, ProgressEvent } from "../shared/types";

export type { ScorerFunction, ProgressEvent } from "../shared/types";

/**
 * Minimal test context interface compatible with node:test's TestContext.
 * We only use `name` from the context, making this compatible with any
 * test runner that provides a `{ name?: string }` context object.
 */
export interface MinimalTestContext {
  name?: string;
}

/**
 * Configuration for `initNodeTestSuite()`.
 */
export interface NodeTestSuiteConfig {
  /** Project name for the Braintrust experiment. */
  projectName: string;
  /** Optional experiment name. Defaults to a timestamp-based name. */
  experimentName?: string;
  /**
   * If true, displays a formatted experiment summary after flushing.
   * Defaults to true.
   */
  displaySummary?: boolean;
  /**
   * Pass `after` from `node:test` to auto-register a flush hook.
   * When provided, `suite.flush()` is called automatically after all tests.
   */
  after?: (fn: () => void | Promise<void>) => void;
  /**
   * Callback for real-time progress events.
   */
  onProgress?: (event: ProgressEvent) => void;
}

/**
 * Configuration for a single eval test case.
 */
export interface EvalConfig {
  /** Test input data, logged to the span. */
  input?: unknown;
  /** Expected output, passed to scorers. */
  expected?: unknown;
  /** Custom metadata, logged to the span. */
  metadata?: Record<string, unknown>;
  /** Tags for organizing test cases. */
  tags?: string[];
  /** Scorer functions to evaluate the output. */
  scorers?: ScorerFunction[];
  /** Override span name (defaults to `t.name`, then `"unnamed test"`). */
  name?: string;
}

/**
 * Context passed to the eval test function.
 */
export interface EvalContext {
  input: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * The public API surface returned by `initNodeTestSuite()`.
 */
export interface NodeTestSuite {
  /**
   * Creates a test function compatible with `node:test`.
   * Pass the result to `test()` from `node:test`.
   *
   * @param config - Eval configuration (input, expected, scorers, etc.)
   * @param fn - The test function. Its return value is logged as output and passed to scorers.
   * @returns A function accepting a test context `t` from `node:test`.
   */
  eval(
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ): (t: MinimalTestContext) => Promise<void>;

  /**
   * Flush the experiment: summarize results and send data to Braintrust.
   * Called automatically if `after` was provided in the config.
   */
  flush(): Promise<void>;

  /**
   * Log custom outputs to the current span.
   * Must be called within a `suite.eval()` test function.
   */
  logOutputs(outputs: Record<string, unknown>): void;

  /**
   * Log custom feedback/scores to the current span.
   * Must be called within a `suite.eval()` test function.
   */
  logFeedback(feedback: {
    name: string;
    score: number;
    metadata?: Record<string, unknown>;
  }): void;

  /**
   * Get the current active span, if any.
   */
  getCurrentSpan(): Span | null;
}
