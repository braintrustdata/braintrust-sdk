import type { Score } from "../../../util/score";

// Scorer function type
export type ScorerFunction<Output = unknown> = (args: {
  output: Output;
  expected?: unknown;
  input?: unknown;
  metadata?: Record<string, unknown>;
}) => Score | Promise<Score> | number | null | Array<Score>;

/**
 * Configuration for a single eval test case.
 * Shared across test runner integrations (node-test, bun-test, etc.).
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
  /** Override span name (defaults to the test name). */
  name?: string;
}

/**
 * Context passed to the eval test function.
 * Shared across test runner integrations (node-test, bun-test, etc.).
 */
export interface EvalContext {
  input: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown>;
}

// Progress event types for real-time test reporting
export type ProgressEvent =
  | { type: "suite_start"; suiteName: string }
  | { type: "test_start"; testName: string }
  | {
      type: "test_complete";
      testName: string;
      passed: boolean;
      duration: number;
    }
  | {
      type: "suite_complete";
      suiteName: string;
      passed: number;
      failed: number;
    };
