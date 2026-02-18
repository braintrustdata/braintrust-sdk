/**
 * Shared types for Braintrust smoke tests
 */

export interface LoggerSpan {
  log: (payload: Record<string, unknown>) => void;
  end: () => void;
  setAttributes?: (attrs: Record<string, unknown>) => void;
}

export interface LoggerInstance {
  startSpan: (options: { name: string }) => LoggerSpan;
  flush: () => Promise<void>;
  log?: (payload: Record<string, unknown>) => void;
}

export interface BackgroundLogger {
  drain: () => Promise<unknown[]>;
}

export interface TestingExports {
  setInitialTestState: () => void;
  simulateLoginForTests: () => Promise<unknown> | unknown;
  simulateLogoutForTests?: () => Promise<unknown> | unknown;
  useTestBackgroundLogger: () => BackgroundLogger;
  clearTestBackgroundLogger: () => void;
}

export interface TestResult {
  status: "pass" | "fail" | "xfail"; // xfail = expected failure
  name: string;
  message?: string;
  error?: {
    message: string;
    stack?: string;
  };
}

// ---- Braintrust module surface types ----

export type EvalScoreFn = (args: {
  output: string;
  expected: string;
}) =>
  | { name: string; score: number }
  | Promise<{ name: string; score: number }>;

export type EvalFn = (
  name: string,
  config: {
    data: Array<{ input: string; expected: string }>;
    task: (input: string) => Promise<string>;
    scores: EvalScoreFn[];
  },
  options?: {
    noSendLogs?: boolean;
    returnResults?: boolean;
  },
) => Promise<unknown>;
