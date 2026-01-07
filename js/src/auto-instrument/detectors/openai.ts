import type { Config } from "../config";
import { log } from "../util";

const WRAPPED_SYMBOL = Symbol.for("braintrust.wrapped.openai");

export function wrapOpenAI(exports: any, config: Config): any {
  if (!exports || typeof exports !== "object") {
    return exports;
  }

  if (exports[WRAPPED_SYMBOL]) {
    log(config, "info", "OpenAI module already wrapped, skipping");
    return exports;
  }

  log(config, "info", "Wrapping OpenAI module exports");

  const OpenAIClass = exports.default || exports.OpenAI;

  if (!OpenAIClass || typeof OpenAIClass !== "function") {
    log(config, "warn", "Could not find OpenAI constructor in exports");
    return exports;
  }

  const WrappedOpenAI = new Proxy(OpenAIClass, {
    construct(Target, args) {
      const instance = new Target(...args);

      try {
        let braintrustWrapOpenAI;
        if (
          typeof globalThis.__inherited_braintrust_wrap_openai === "function"
        ) {
          braintrustWrapOpenAI = globalThis.__inherited_braintrust_wrap_openai;
        }

        if (typeof braintrustWrapOpenAI === "function") {
          log(config, "info", "Auto-wrapping OpenAI instance");
          return braintrustWrapOpenAI(instance);
        } else {
          log(config, "warn", "Braintrust wrapOpenAI function not found");
        }
      } catch (error) {
        log(
          config,
          "warn",
          "Failed to apply Braintrust wrapper to OpenAI instance:",
          error instanceof Error ? error.message : String(error),
        );
      }

      return instance;
    },
  });

  return WrappedOpenAI;
}
