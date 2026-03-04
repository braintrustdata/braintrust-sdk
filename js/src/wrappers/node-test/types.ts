import type { EvalConfig, EvalContext } from "../shared/types";

export type { ScorerFunction, EvalConfig, EvalContext } from "../shared/types";

/** Progress events emitted by the node-test integration. */
export type NodeTestProgressEvent =
  | { type: "test_start"; testName: string }
  | {
      type: "test_complete";
      testName: string;
      passed: boolean;
      duration: number;
    };

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
   * Emits `test_start` and `test_complete` events.
   */
  onProgress?: (event: NodeTestProgressEvent) => void;
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
}
