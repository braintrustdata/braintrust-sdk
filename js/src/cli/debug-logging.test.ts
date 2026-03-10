import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@next/env", () => ({
  loadEnvConfig: vi.fn(),
}));

vi.mock("dotenv", () => ({
  config: vi.fn(() => ({})),
}));

vi.mock("./index", () => ({
  handleBuildFailure: vi.fn(),
  initializeHandles: vi.fn(),
}));

vi.mock("../logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../logger")>();
  return {
    ...actual,
    login: vi.fn().mockResolvedValue(undefined),
  };
});

import { login } from "../logger";
import { resetDebugLoggingArgsForTests } from "./util/debug-logging";
import { loadCLIEnv } from "./util/bundle";

describe("CLI debug logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDebugLoggingArgsForTests();
  });

  test("loadCLIEnv forwards debugLogging to login", async () => {
    await loadCLIEnv({
      verbose: false,
      api_key: "test-key",
      org_name: "test-org",
      app_url: "https://braintrust.dev",
      debug_logging: "full",
    });

    expect(login).toHaveBeenCalledWith({
      apiKey: "test-key",
      orgName: "test-org",
      appUrl: "https://braintrust.dev",
      debugLogging: "full",
    });
  });

  test("loadCLIEnv treats --verbose as a deprecated alias for --debug-logging full", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await loadCLIEnv({
      verbose: true,
      api_key: "test-key",
      org_name: "test-org",
      app_url: "https://braintrust.dev",
    });

    expect(login).toHaveBeenCalledWith({
      apiKey: "test-key",
      orgName: "test-org",
      appUrl: "https://braintrust.dev",
      debugLogging: "full",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Warning: --verbose is deprecated and will be removed in a future version of braintrust. Use --debug-logging full to see full stack traces and troubleshooting details.",
    );
  });
});
