import type { Span } from "../../logger";

export interface TestConfig {
  input?: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface TestContext {
  input?: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown>;
}

export type TestFunction<VitestContext = unknown> = {
  (name: string, fn: (context: VitestContext) => void | Promise<void>): void;
  skip?: TestFunction<VitestContext>;
  only?: TestFunction<VitestContext>;
  concurrent?: TestFunction<VitestContext>;
  todo?: (name: string) => void;
  each?: <T>(
    cases: readonly T[],
  ) => (name: string, fn: (context: T) => void | Promise<void>) => void;
};

export type DescribeFunction = {
  (name: string, factory: () => void): void;
  skip?: DescribeFunction;
  only?: DescribeFunction;
  concurrent?: DescribeFunction;
  todo?: (name: string) => void;
  each?: <T>(
    cases: readonly T[],
  ) => (name: string, factory: () => void) => void;
};

export interface WrappedTest<VitestContext = unknown> {
  (name: string, fn: (context: VitestContext) => void | Promise<void>): void;
  (
    name: string,
    config: TestConfig,
    fn: (context: TestContext & VitestContext) => void | Promise<void>,
  ): void;
  skip: WrappedTest<VitestContext>;
  only: WrappedTest<VitestContext>;
  concurrent: WrappedTest<VitestContext>;
  todo: (name: string) => void;
  each: <T>(
    cases: readonly T[],
  ) => (
    name: string,
    fn: (context: T & TestContext & VitestContext) => void | Promise<void>,
  ) => void;
}

export interface WrappedDescribe {
  (name: string, factory: () => void): void;
  skip: WrappedDescribe;
  only: WrappedDescribe;
  concurrent: WrappedDescribe;
  todo: (name: string) => void;
  each: <T>(cases: readonly T[]) => (name: string, factory: () => void) => void;
}

export interface VitestMethods<VitestContext = unknown, ExpectType = unknown> {
  test: TestFunction<VitestContext>;
  it?: TestFunction<VitestContext>;
  expect: ExpectType;
  describe: DescribeFunction;
  beforeAll?: (fn: () => void | Promise<void>) => void;
  afterAll?: (fn: () => void | Promise<void>) => void;
  beforeEach?: (fn: (context: VitestContext) => void | Promise<void>) => void;
  afterEach?: (fn: (context: VitestContext) => void | Promise<void>) => void;
}

export interface BraintrustVitest<
  VitestContext = unknown,
  ExpectType = unknown,
> {
  test: WrappedTest<VitestContext>;
  it: WrappedTest<VitestContext>;
  expect: ExpectType;
  describe: WrappedDescribe;
  beforeAll: (fn: () => void | Promise<void>) => void;
  afterAll: (fn: () => void | Promise<void>) => void;
  beforeEach?: (fn: (context: VitestContext) => void | Promise<void>) => void;
  afterEach?: (fn: (context: VitestContext) => void | Promise<void>) => void;
  logOutputs: (outputs: Record<string, unknown>) => void;
  logFeedback: (feedback: {
    name: string;
    score: number;
    metadata?: Record<string, unknown>;
  }) => void;
  getCurrentSpan: () => Span | null;
  /**
   * Helper function to flush the experiment and optionally display a summary.
   * Use this in afterAll() instead of manually calling getExperimentContext().
   *
   * @param options - Optional configuration
   * @param options.displaySummary - Whether to display the experiment summary (defaults to true)
   */
  flushExperiment: (options?: { displaySummary?: boolean }) => Promise<void>;
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

export interface WrapperConfig {
  projectName?: string;
  /**
   * If true, displays a formatted experiment summary with scores and URL after the test suite completes.
   * Defaults to true. Set to false to suppress the summary output.
   */
  displaySummary?: boolean;
  /**
   * Callback for real-time progress events.
   * Called when tests start, complete, or progress updates occur.
   * Progress reporting is always enabled when this callback is provided.
   */
  onProgress?: (event: ProgressEvent) => void;
}
