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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestFunction = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DescribeFunction = any;

export interface WrappedTest {
  (name: string, fn: (context: any) => void | Promise<void>): void;
  (
    name: string,
    config: TestConfig,
    fn: (context: TestContext) => void | Promise<void>,
  ): void;
  skip: WrappedTest;
  only: WrappedTest;
  concurrent: WrappedTest;
  todo: (name: string) => void;
  each: <T>(
    cases: readonly T[],
  ) => (
    name: string,
    fn: (context: T & TestContext) => void | Promise<void>,
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

export interface VitestMethods {
  test: any;
  it?: any;
  expect: any;
  describe: any;
  beforeAll?: any;
  afterAll?: any;
  beforeEach?: any;
  afterEach?: any;
}

export interface BraintrustVitest {
  test: WrappedTest;
  it: WrappedTest;
  expect: any;
  describe: WrappedDescribe;
  beforeAll: any;
  afterAll: any;
  beforeEach?: any;
  afterEach?: any;
  logOutputs: (outputs: Record<string, unknown>) => void;
  logFeedback: (feedback: {
    name: string;
    score: number;
    metadata?: Record<string, unknown>;
  }) => void;
  getCurrentSpan: () => Span | null;
}

export interface WrapperConfig {
  projectName?: string;
  autoFlush?: boolean;
}
