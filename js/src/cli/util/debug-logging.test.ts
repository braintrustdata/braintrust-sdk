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

  test("shouldShowDetailedErrors only enables detailed errors for full", () => {
    expect(shouldShowDetailedErrors(undefined)).toBe(false);
    expect(shouldShowDetailedErrors("setup")).toBe(false);
    expect(shouldShowDetailedErrors("full")).toBe(true);
  });

  test("normalizeDebugLoggingArgs upgrades verbose to full and warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const args = {
      verbose: true,
      debug_logging: undefined as "setup" | "full" | undefined,
    };

    normalizeDebugLoggingArgs(args);
    normalizeDebugLoggingArgs(args);

    expect(args.debug_logging).toBe("full");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      `Warning: ${VERBOSE_DEPRECATION_MESSAGE}`,
    );
  });

  test("normalizeDebugLoggingArgs preserves explicit debug logging", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const args = { verbose: true, debug_logging: "setup" as const };

    normalizeDebugLoggingArgs(args);

    expect(args.debug_logging).toBe("setup");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
