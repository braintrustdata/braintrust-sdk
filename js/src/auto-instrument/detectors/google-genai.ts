import type { Config } from "../config";
import { log } from "../util";

const WRAPPED_SYMBOL = Symbol.for("braintrust.wrapped.google-genai");

export function wrapGoogleGenAI(exports: any, config: Config): any {
  if (!exports || typeof exports !== "object") {
    return exports;
  }

  if (exports[WRAPPED_SYMBOL]) {
    log(config, "info", "Google GenAI module already wrapped, skipping");
    return exports;
  }

  log(config, "info", "Wrapping Google GenAI module exports");

  try {
    let braintrustWrapGoogleGenAI;
    if (
      typeof globalThis.__inherited_braintrust_wrap_google_genai === "function"
    ) {
      braintrustWrapGoogleGenAI =
        globalThis.__inherited_braintrust_wrap_google_genai;
    }

    if (typeof braintrustWrapGoogleGenAI === "function") {
      log(config, "info", "Auto-wrapping Google GenAI module");
      const wrapped = braintrustWrapGoogleGenAI(exports);
      // The wrapped module already has the symbol handled by the Proxy
      return wrapped;
    } else {
      log(config, "warn", "Braintrust wrapGoogleGenAI function not found");
    }
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
