import type { Config } from "../config";
import { log } from "../util";

const WRAPPED_SYMBOL = Symbol.for("braintrust.wrapped.anthropic");

export function wrapAnthropic(exports: any, config: Config): any {
  if (!exports || typeof exports !== "object") {
    return exports;
  }

  if (exports[WRAPPED_SYMBOL]) {
    log(config, "info", "Anthropic module already wrapped, skipping");
    return exports;
  }

  log(config, "info", "Wrapping Anthropic module exports");

  const AnthropicClass = exports.default || exports.Anthropic;

  if (!AnthropicClass || typeof AnthropicClass !== "function") {
    log(config, "warn", "Could not find Anthropic constructor in exports");
    return exports;
  }

  const WrappedAnthropic = new Proxy(AnthropicClass, {
    construct(Target, args) {
      const instance = new Target(...args);

      try {
        let braintrustWrapAnthropic;
        if (
          typeof globalThis.__inherited_braintrust_wrap_anthropic === "function"
        ) {
          braintrustWrapAnthropic =
            globalThis.__inherited_braintrust_wrap_anthropic;
        }

        if (typeof braintrustWrapAnthropic === "function") {
          log(config, "info", "Auto-wrapping Anthropic instance");
          return braintrustWrapAnthropic(instance);
        } else {
          log(config, "warn", "Braintrust wrapAnthropic function not found");
        }
      } catch (error) {
        log(
          config,
          "warn",
          "Failed to apply Braintrust wrapper to Anthropic instance:",
          error instanceof Error ? error.message : String(error),
        );
      }

      return instance;
    },
  });

  return WrappedAnthropic;
}
