import type { Config } from "../config";
import { log } from "../util";

const WRAPPED_SYMBOL = Symbol.for("braintrust.wrapped.ai-sdk");

export function wrapAISDK(exports: any, config: Config): any {
  if (!exports || typeof exports !== "object") {
    return exports;
  }

  if (exports[WRAPPED_SYMBOL]) {
    log(config, "info", "AI SDK module already wrapped, skipping");
    return exports;
  }

  log(config, "info", "Wrapping AI SDK module exports");

  try {
    let braintrustWrapAISDK;
    if (typeof globalThis.__inherited_braintrust_wrap_ai_sdk === "function") {
      braintrustWrapAISDK = globalThis.__inherited_braintrust_wrap_ai_sdk;
    }

    if (typeof braintrustWrapAISDK === "function") {
      log(config, "info", "Auto-wrapping AI SDK module");
      const wrapped = braintrustWrapAISDK(exports);
      // The wrapped module already has the symbol handled by the Proxy
      return wrapped;
    } else {
      log(config, "warn", "Braintrust wrapAISDK function not found");
    }
  } catch (error) {
    log(
      config,
      "warn",
      "Failed to apply Braintrust wrapper to AI SDK module:",
      error instanceof Error ? error.message : String(error),
    );
  }

  return exports;
}
