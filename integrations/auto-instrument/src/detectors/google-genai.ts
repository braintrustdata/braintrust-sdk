import type { Config } from "../config";
import { log } from "../util";

// Track wrapped modules internally instead of using symbols on the exports object
// (import-in-the-middle intercepts property assignments and doesn't support Symbols)
const wrappedModules = new WeakSet();

// Declare global for the wrapper function we'll import from braintrust
declare global {
  // eslint-disable-next-line no-var
  var __inherited_braintrust_wrap_google_genai_individual:
    | ((exports: any) => void)
    | undefined;
}

export function wrapGoogleGenAI(exports: any, config: Config): any {
  if (!exports || typeof exports !== "object") {
    return exports;
  }

  if (wrappedModules.has(exports)) {
    log(config, "info", "Google GenAI module already wrapped, skipping");
    return exports;
  }

  log(config, "info", "Wrapping Google GenAI module exports");

  try {
    // Use the individual wrapper function that doesn't create a module-level Proxy
    if (
      typeof globalThis.__inherited_braintrust_wrap_google_genai_individual ===
      "function"
    ) {
      log(config, "info", "Auto-wrapping Google GenAI module");

      // Wrap exports in-place without creating a Proxy
      globalThis.__inherited_braintrust_wrap_google_genai_individual(exports);

      // Mark as wrapped
      wrappedModules.add(exports);

      log(config, "info", "Successfully wrapped Google GenAI exports");
    } else {
      log(
        config,
        "warn",
        "Braintrust wrapGoogleGenAIIndividualExports function not found",
      );
    }

    return exports;
  } catch (error) {
    log(
      config,
      "warn",
      "Failed to apply Braintrust wrapper to Google GenAI module:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return exports;
}
