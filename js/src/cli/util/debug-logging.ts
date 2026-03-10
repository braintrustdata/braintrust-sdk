import { warning } from "../../framework";
import type { CommonArgs } from "./types";

export const VERBOSE_DEPRECATION_MESSAGE =
  "--verbose is deprecated and will be removed in a future version of braintrust. Use --debug-logging full to see full stack traces and troubleshooting details.";

let hasWarnedAboutVerboseFlag = false;

export function shouldShowDetailedErrors(
  debugLogging: CommonArgs["debug_logging"] | undefined,
): boolean {
  return debugLogging === "full";
}

export function normalizeDebugLoggingArgs<
  T extends Pick<CommonArgs, "verbose" | "debug_logging">,
>(args: T): T {
  if (!args.verbose) {
    return args;
  }

  if (!hasWarnedAboutVerboseFlag) {
    hasWarnedAboutVerboseFlag = true;
    console.warn(warning(VERBOSE_DEPRECATION_MESSAGE));
  }

  if (!args.debug_logging) {
    args.debug_logging = "full";
  }

  return args;
}

export function resetDebugLoggingArgsForTests(): void {
  hasWarnedAboutVerboseFlag = false;
}
