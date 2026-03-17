import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  normalizeDebugLoggingArgs,
  resetDebugLoggingArgsForTests,
  shouldShowDetailedErrors,
  VERBOSE_DEPRECATION_MESSAGE,
} from "./debug-logging";

describe("CLI debug logging helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetDebugLoggingArgsForTests();
  });

  test("shouldShowDetailedErrors only enables detailed errors for debug", () => {
    expect(shouldShowDetailedErrors(undefined)).toBe(false);
    expect(shouldShowDetailedErrors("info")).toBe(false);
    expect(shouldShowDetailedErrors("debug")).toBe(true);
  });

  test("normalizeDebugLoggingArgs upgrades verbose to debug and warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const args = {
      verbose: true,
      debug_logging: undefined as
        | "error"
        | "warn"
        | "info"
        | "debug"
        | undefined,
    };

    normalizeDebugLoggingArgs(args);
    normalizeDebugLoggingArgs(args);

    expect(args.debug_logging).toBe("debug");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      `Warning: ${VERBOSE_DEPRECATION_MESSAGE}`,
    );
  });

  test("normalizeDebugLoggingArgs preserves explicit debug logging", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const args = { verbose: true, debug_logging: "info" as const };

    normalizeDebugLoggingArgs(args);

    expect(args.debug_logging).toBe("info");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
