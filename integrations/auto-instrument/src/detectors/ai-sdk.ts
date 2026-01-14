import type { Config } from "../config";
import { log } from "../util";

// Track wrapped modules internally instead of using symbols on the exports object
// (import-in-the-middle intercepts property assignments and doesn't support Symbols)
const wrappedModules = new WeakSet();

// Declare global for the wrapper function we'll import from braintrust
declare global {
  // eslint-disable-next-line no-var
  var __inherited_braintrust_wrap_ai_sdk_individual:
    | ((exports: any, options?: any) => void)
    | undefined;
}

export function wrapAISDK(exports: any, config: Config): any {
  if (!exports || typeof exports !== "object") {
    return exports;
  }

  if (wrappedModules.has(exports)) {
    log(config, "info", "AI SDK module already wrapped, skipping");
    return exports;
  }

  log(config, "info", "Wrapping AI SDK module exports");

  try {
    // Use the individual wrapper function that doesn't create a module-level Proxy
    if (
      typeof globalThis.__inherited_braintrust_wrap_ai_sdk_individual ===
      "function"
    ) {
      log(config, "info", "Auto-wrapping AI SDK module");

      // Wrap exports in-place without creating a Proxy
      globalThis.__inherited_braintrust_wrap_ai_sdk_individual(exports);

      // Mark as wrapped
      wrappedModules.add(exports);

      log(config, "info", "Successfully wrapped AI SDK exports");
    } else {
      log(
        config,
        "warn",
        "Braintrust wrapAISDKIndividualExports function not found",
      );
    }

    return exports;
  } catch (error) {
    log(
      config,
      "warn",
      "Failed to apply Braintrust wrapper to AI SDK module:",
      error instanceof Error ? error.message : String(error),
    );
    if (config.debug) {
      console.error(error);
    }
  }

  return exports;
}
