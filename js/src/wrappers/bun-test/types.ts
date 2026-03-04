export type { ScorerFunction, EvalConfig, EvalContext } from "../shared/types";

import type { EvalConfig, EvalContext } from "../shared/types";

/** Progress events emitted by the bun-test integration. */
export type BunTestProgressEvent =
  | { type: "test_start"; testName: string }
  | {
      type: "test_complete";
      testName: string;
      passed: boolean;
      duration: number;
    };

/** A single traced eval test function signature. */
type EvalTestFn = (
  name: string,
  config: EvalConfig,
  fn: (context: EvalContext) => unknown | Promise<unknown>,
) => void;

/** Conditional modifier: returns an EvalTestFn based on a boolean condition. */
type ConditionalEvalTestFn = (condition: boolean) => EvalTestFn;

/**
 * The wrapped test function with `(name, config, fn)` signature.
 */
export interface SuiteTestFunction extends EvalTestFn {
  skip: EvalTestFn;
  only: EvalTestFn;
  todo: (
    name: string,
    config?: EvalConfig,
    fn?: (context: EvalContext) => unknown | Promise<unknown>,
  ) => void;
  failing: EvalTestFn;
  concurrent: EvalTestFn;
  serial: EvalTestFn;
  if: ConditionalEvalTestFn;
  skipIf: ConditionalEvalTestFn;
  todoIf: ConditionalEvalTestFn;
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
