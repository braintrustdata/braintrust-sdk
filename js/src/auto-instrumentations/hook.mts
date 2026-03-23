/**
 * Unified loader hook for auto-instrumentation (ESM + CJS).
 *
 * Usage:
 *   node --import @braintrust/auto-instrumentations/hook.mjs app.js
 *
 * This hook performs AST transformation at load-time for BOTH ESM and CJS modules,
 * injecting TracingChannel calls into AI SDK functions.
 *
 * Many modern apps use a mix of ESM and CJS modules, so this single hook
 * handles both:
 * - ESM modules: Transformed via register() loader hook
 * - CJS modules: Transformed via ModulePatch monkey-patching Module._compile
 */

import { register } from "node:module";
import { openaiConfigs } from "./configs/openai.js";
import { anthropicConfigs } from "./configs/anthropic.js";
import { aiSDKConfigs } from "./configs/ai-sdk.js";
import { claudeAgentSDKConfigs } from "./configs/claude-agent-sdk.js";
import { googleGenAIConfigs } from "./configs/google-genai.js";
import { ModulePatch } from "./loader/cjs-patch.js";

// Patch diagnostics_channel.tracePromise to handle APIPromise correctly
// MUST be done here (before any SDK code runs) to fix Anthropic APIPromise incompatibility
// Construct the module path dynamically to prevent build from stripping "node:" prefix
const dcPath = ["node", "diagnostics_channel"].join(":");
const dc: any = await import(/* @vite-ignore */ dcPath as any);

// Get TracingChannel class by creating a dummy instance
const dummyChannel = dc.tracingChannel("dummy");
const TracingChannel = dummyChannel.constructor;

if (
  TracingChannel &&
  !Object.getOwnPropertyDescriptor(TracingChannel.prototype, "hasSubscribers")
) {
  Object.defineProperty(TracingChannel.prototype, "hasSubscribers", {
    configurable: true,
    enumerable: false,
    get(this: {
      start?: { hasSubscribers?: boolean };
      end?: { hasSubscribers?: boolean };
      asyncStart?: { hasSubscribers?: boolean };
      asyncEnd?: { hasSubscribers?: boolean };
      error?: { hasSubscribers?: boolean };
    }) {
      return Boolean(
        this.start?.hasSubscribers ||
        this.end?.hasSubscribers ||
        this.asyncStart?.hasSubscribers ||
        this.asyncEnd?.hasSubscribers ||
        this.error?.hasSubscribers,
      );
    },
  });
}

if (TracingChannel && TracingChannel.prototype.tracePromise) {
  TracingChannel.prototype.tracePromise = function (
    fn: any,
    context: any = {},
    thisArg: any,
    ...args: any[]
  ) {
    const { start, end, asyncStart, asyncEnd, error } = this;

    function publishRejected(err: any) {
      context.error = err;
      error?.publish(context);
      asyncStart?.publish(context);
      asyncEnd?.publish(context);
    }

    function publishResolved(result: any) {
      context.result = result;
      asyncStart?.publish(context);
      asyncEnd?.publish(context);
    }

    start?.publish(context);

    try {
      // PATCHED: Removed instanceof Promise check and Promise.resolve() wrapper
      // This allows APIPromise and other Promise subclasses to work correctly

      const result = Reflect.apply(fn, thisArg, args);

      if (
        result &&
        (typeof result === "object" || typeof result === "function") &&
        typeof (result as any).then === "function"
      ) {
        if (result.constructor === Promise) {
          return (result as any).then(
            (result: unknown) => {
              publishResolved(result);
              return result;
            },
            (err: any) => {
              publishRejected(err);
              return Promise.reject(err);
            },
          );
        }

        // Preserve the original promise-like object so SDK helper methods
        // like Anthropic APIPromise.withResponse() remain available.
        void (result as any).then(
          (resolved: any) => {
            try {
              publishResolved(resolved);
            } catch {
              // Preserve wrapped promise semantics even if instrumentation fails.
            }
          },
          (err: any) => {
            try {
              publishRejected(err);
            } catch {
              // Preserve wrapped promise semantics even if instrumentation fails.
            }
          },
        );

        return result;
      }

      publishResolved(result);
      return result;
    } catch (err) {
      publishRejected(err);
      throw err;
    } finally {
      end?.publish(context);
    }
  };
}

// Combine all instrumentation configs
const allConfigs = [
  ...openaiConfigs,
  ...anthropicConfigs,
  ...aiSDKConfigs,
  ...claudeAgentSDKConfigs,
  ...googleGenAIConfigs,
];

// 1. Register ESM loader for ESM modules
register("./loader/esm-hook.mjs", {
  parentURL: import.meta.url,
  data: { instrumentations: allConfigs },
} as any);

// 2. Also load CJS register for CJS modules (many apps use mixed ESM/CJS)
try {
  const patch = new ModulePatch({ instrumentations: allConfigs });
  patch.patch();

  if (process.env.DEBUG === "@braintrust*" || process.env.DEBUG === "*") {
    console.log(
      "[Braintrust] Auto-instrumentation active (ESM + CJS) for:",
      allConfigs.map((c) => c.channelName).join(", "),
    );
  }
} catch (err) {
  // CJS patch failed, but ESM hook is still active
  if (process.env.DEBUG === "@braintrust*" || process.env.DEBUG === "*") {
    console.log(
      "[Braintrust] Auto-instrumentation active (ESM only) for:",
      allConfigs.map((c) => c.channelName).join(", "),
    );
    console.error("[Braintrust] CJS patch failed:", err);
  }
}
