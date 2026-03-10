import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  BraintrustState,
  _exportsForTestingOnly,
  initLogger,
  login,
} from "./logger";
import {
  debugLogger,
  getEnvDebugLogLevel,
  resetDebugLoggerForTests,
} from "./debug-logger";
import { configureNode } from "./node/config";

configureNode();

describe("debug logger", () => {
  const originalLogLevel = process.env.BRAINTRUST_LOG_LEVEL;

  beforeEach(() => {
    delete process.env.BRAINTRUST_LOG_LEVEL;
    resetDebugLoggerForTests();
    _exportsForTestingOnly.simulateLogoutForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalLogLevel === undefined) {
      delete process.env.BRAINTRUST_LOG_LEVEL;
    } else {
      process.env.BRAINTRUST_LOG_LEVEL = originalLogLevel;
    }
    resetDebugLoggerForTests();
    _exportsForTestingOnly.simulateLogoutForTests();
    vi.restoreAllMocks();
  });

  test("setup level emits info, warn, and error but not debug", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const state = {
      getDebugLogLevel: () => "setup" as const,
      hasDebugLogLevelOverride: () => true,
    };

    const scopedLogger = debugLogger.forState(state);

    scopedLogger.info("info");
    scopedLogger.warn("warn");
    scopedLogger.error("error");
    scopedLogger.debug("debug");

    expect(logSpy).toHaveBeenCalledWith("[braintrust]", "info");
    expect(warnSpy).toHaveBeenCalledWith("[braintrust]", "warn");
    expect(errorSpy).toHaveBeenCalledWith("[braintrust]", "error");
    expect(debugSpy).not.toHaveBeenCalled();
  });

  test("full level emits debug", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const state = {
      getDebugLogLevel: () => "full" as const,
      hasDebugLogLevelOverride: () => true,
    };

    debugLogger.forState(state).debug("debug");

    expect(debugSpy).toHaveBeenCalledWith("[braintrust]", "debug");
  });

  test("default logger resolves the global SDK state", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    _exportsForTestingOnly.setInitialTestState();
    const state = _exportsForTestingOnly.simulateLogoutForTests();
    state.setDebugLogLevel("setup");

    debugLogger.warn("global warning");

    expect(warnSpy).toHaveBeenCalledWith("[braintrust]", "global warning");
  });

  test("BRAINTRUST_LOG_LEVEL accepts setup and full", () => {
    process.env.BRAINTRUST_LOG_LEVEL = "setup";
    expect(getEnvDebugLogLevel()).toBe("setup");

    process.env.BRAINTRUST_LOG_LEVEL = "full";
    expect(getEnvDebugLogLevel()).toBe("full");
  });

  test("BRAINTRUST_LOG_LEVEL rejects invalid values and warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.BRAINTRUST_LOG_LEVEL = "true";

    expect(getEnvDebugLogLevel()).toBeUndefined();
    expect(getEnvDebugLogLevel()).toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[braintrust]",
      'Invalid BRAINTRUST_LOG_LEVEL value "true". Expected "setup" or "full".',
    );
  });

  test("initLogger updates the state debug log level", () => {
    const state = new BraintrustState({});

    initLogger({ state, debugLogging: "full" });

    expect(state.getDebugLogLevel()).toBe("full");
  });

  test("explicitly disabling debug logging overrides the env var", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.BRAINTRUST_LOG_LEVEL = "setup";

    const state = new BraintrustState({ debugLogging: false });
    debugLogger.forState(state).info("info");

    expect(logSpy).not.toHaveBeenCalled();
  });

  test("login updates debug log level even when the state is already logged in", async () => {
    const state = await _exportsForTestingOnly.simulateLoginForTests();

    await login({ debugLogging: "full" });

    expect(state.getDebugLogLevel()).toBe("full");
  });

  test("serialized state preserves the debug log level", async () => {
    const state = new BraintrustState({});
    state.appUrl = "https://braintrust.dev";
    state.appPublicUrl = "https://braintrust.dev";
    state.apiUrl = "https://api.braintrust.dev";
    state.proxyUrl = "https://proxy.braintrust.dev";
    state.orgName = "test-org";
    state.loginToken = "test-token";
    state.loggedIn = true;
    state.setDebugLogLevel("full");

    const deserialized = BraintrustState.deserialize(state.serialize());

    expect(deserialized.getDebugLogLevel()).toBe("full");
  });
});
