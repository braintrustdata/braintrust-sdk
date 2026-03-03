import { configureNode } from "../../node/config";
import {
  _exportsForTestingOnly,
  type TestBackgroundLogger,
} from "../../logger";

/**
 * Sets up the test environment for bun-test wrapper tests.
 * Must be called in beforeAll (top-level await).
 *
 * Returns the background logger for span verification.
 */
export async function setupBunTestEnv(): Promise<TestBackgroundLogger> {
  configureNode();
  _exportsForTestingOnly.setInitialTestState();
  await _exportsForTestingOnly.simulateLoginForTests();
  return _exportsForTestingOnly.useTestBackgroundLogger();
}

export function teardownBunTestEnv(): void {
  _exportsForTestingOnly.clearTestBackgroundLogger();
  _exportsForTestingOnly.simulateLogoutForTests();
}

/**
 * Creates a test-only initExperiment function that uses the in-memory
 * test logger instead of making real API calls.
 */
export function createTestInitExperiment() {
  return (projectName: string, options?: { experiment?: string }) => {
    return _exportsForTestingOnly.initTestExperiment(
      options?.experiment || "test-experiment",
      projectName,
    );
  };
}
