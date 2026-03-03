import { vi } from "vitest";
import { configureNode } from "../../node/config";
import {
  _exportsForTestingOnly,
  type TestBackgroundLogger,
} from "../../logger";
import * as logger from "../../logger";
import type { MinimalTestContext } from "./types";

/**
 * Sets up the test environment for node-test wrapper tests.
 * Must be called at module level (top-level await).
 *
 * Returns the background logger for span verification.
 */
export async function setupNodeTestEnv(): Promise<TestBackgroundLogger> {
  configureNode();
  _exportsForTestingOnly.setInitialTestState();
  await _exportsForTestingOnly.simulateLoginForTests();
  const bgLogger = _exportsForTestingOnly.useTestBackgroundLogger();

  vi.spyOn(logger, "initExperiment").mockImplementation(
    (projectName: string, options?: any) => {
      return _exportsForTestingOnly.initTestExperiment(
        options?.experiment || "test-experiment",
        projectName,
      );
    },
  );

  return bgLogger;
}

export async function teardownNodeTestEnv(): Promise<void> {
  await _exportsForTestingOnly.clearTestBackgroundLogger();
  await _exportsForTestingOnly.simulateLogoutForTests();
}

export function mockTestContext(name: string): MinimalTestContext {
  return { name };
}
