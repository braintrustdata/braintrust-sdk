/**
 * Helper functions for setting up and tearing down test state
 */

import type { TestAdapters, TestingExports } from "./types";

export interface SetupTestEnvironmentOptions {
  initLogger: TestAdapters["initLogger"];
  testingExports: TestingExports;
  projectName?: string;
  canUseFileSystem?: boolean;
  canUseCLI?: boolean;
  environment?: string;
}

/**
 * Set up the test environment with proper state initialization
 */
export async function setupTestEnvironment(
  options: SetupTestEnvironmentOptions,
): Promise<TestAdapters> {
  const {
    initLogger,
    testingExports,
    canUseFileSystem = true,
    canUseCLI = true,
    environment = "node",
  } = options;

  // Initialize test state
  testingExports.setInitialTestState();
  await testingExports.simulateLoginForTests();

  // Get the background logger for capturing events
  const backgroundLogger = testingExports.useTestBackgroundLogger();

  return {
    initLogger,
    testingExports,
    backgroundLogger,
    canUseFileSystem,
    canUseCLI,
    environment,
  };
}

/**
 * Clean up the test environment
 */
export async function cleanupTestEnvironment(
  adapters: TestAdapters,
): Promise<void> {
  const { testingExports } = adapters;

  testingExports.clearTestBackgroundLogger();

  if (typeof testingExports.simulateLogoutForTests === "function") {
    await testingExports.simulateLogoutForTests();
  }
}

/**
 * Run a test with automatic setup and cleanup
 */
export async function withTestEnvironment<T>(
  options: SetupTestEnvironmentOptions,
  testFn: (adapters: TestAdapters) => Promise<T>,
): Promise<T> {
  const adapters = await setupTestEnvironment(options);

  try {
    return await testFn(adapters);
  } finally {
    await cleanupTestEnvironment(adapters);
  }
}
