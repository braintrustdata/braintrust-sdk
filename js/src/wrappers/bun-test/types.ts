import type { ScorerFunction } from "../shared/types";

export type { ScorerFunction } from "../shared/types";

/** Progress events emitted by the bun-test integration. */
export type BunTestProgressEvent =
  | { type: "test_start"; testName: string }
  | {
      type: "test_complete";
      testName: string;
      passed: boolean;
      duration: number;
    };

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
  /** Override span name (defaults to the test name). */
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
 * The wrapped test function with `(name, config, fn)` signature.
 */
export interface SuiteTestFunction {
  (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ): void;
  skip: (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  only: (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  todo: (
    name: string,
    config?: EvalConfig,
    fn?: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  failing: (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  concurrent: (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  serial: (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  if: (
    condition: boolean,
  ) => (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  skipIf: (
    condition: boolean,
  ) => (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  todoIf: (
    condition: boolean,
  ) => (
    name: string,
    config: EvalConfig,
    fn: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
}

/**
 * Configuration for `initBunTestSuite()`.
 *
 * The `TTest` generic forwards the type of your `test` function
 * (e.g. `Test<[]>` from `bun:test`) without re-declaring it.
 */
export interface BunTestSuiteConfig<
  TTest extends (...args: any[]) => any = (...args: any[]) => any,
> {
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
   * The `test` function from `bun:test`. Required.
   * The exact type is forwarded via the `TTest` generic so no
   * wrapper interface is needed.
   */
  test: TTest;
  /**
   * Pass `afterAll` from `bun:test` to auto-register a flush hook.
   * When provided, `suite.flush()` is called automatically after all tests.
   */
  afterAll?: (fn: () => void | Promise<void>) => void;
  /**
   * Callback for real-time progress events.
   * Emits `test_start` and `test_complete` events.
   */
  onProgress?: (event: BunTestProgressEvent) => void;
  /**
   * @internal For testing only. Override the experiment initialization function.
   */
  _initExperiment?: (
    projectName: string,
    options?: { experiment?: string },
  ) => any;
}

/**
 * The public API surface returned by `initBunTestSuite()`.
 */
export interface BunTestSuite {
  /**
   * Wrapped test function that creates a traced eval.
   * Call as `suite.test(name, config, fn)`.
   * Supports modifiers: `.skip`, `.only`, `.todo`, `.failing`,
   * `.concurrent`, `.serial`, `.if`, `.skipIf`, `.todoIf`.
   */
  test: SuiteTestFunction;

  /**
   * Alias for `suite.test` (Jest/Vitest convention).
   */
  it: SuiteTestFunction;

  /**
   * Flush the experiment: summarize results and send data to Braintrust.
   * Called automatically if `afterAll` was provided in the config.
   */
  flush(): Promise<void>;
}
