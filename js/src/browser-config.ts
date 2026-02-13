// Browser-safe isomorph that noops Node.js features
// This file is only used for the /browser, /edge-light, /workerd exports

import iso from "./isomorph";
import { _internalSetInitialState, BraintrustState } from "./logger";
import { BRAINTRUST_STATE_SYMBOL_NAME } from "./symbol-name";

// This is copied from next.js. It seems they define AsyncLocalStorage in the edge
// environment, even though it's not defined in the browser.
import type { AsyncLocalStorage as NodeAsyncLocalStorage } from "async_hooks";

declare global {
  var AsyncLocalStorage: typeof NodeAsyncLocalStorage;
}
// End copied code

let messageShown = false;
let browserConfigured = false;

/**
 * Configure the isomorph for browser environments.
 */
export function configureBrowser(): void {
  if (browserConfigured) {
    return;
  }

  // Show informational message once
  if (!messageShown && typeof console !== "undefined") {
    console.info(
      "This entrypoint is no longer supported.\n\n" +
        "You should be using entrypoints:\n\n" +
        "- `/workerd` (cloudflare envs)\n" +
        "- `/edge-light` (next-js or other edge envs)\n\n" +
        "If you'd like to use braintrust in the browser use the dedicated package: @braintrust/browser\n",
    );
    messageShown = true;
  }

  // Configure browser-safe implementations
  iso.buildType = "browser";

  try {
    if (typeof AsyncLocalStorage !== "undefined") {
      iso.newAsyncLocalStorage = <T>() => new AsyncLocalStorage<T>();
    }
  } catch {
    // Ignore
  }

  iso.getEnv = (name: string) => {
    if (typeof process === "undefined" || typeof process.env === "undefined") {
      return undefined;
    }
    return process.env[name];
  };

  // Implement browser-compatible hash function using a simple hash algorithm
  iso.hash = (data: string): string => {
    // Simple hash function for browser compatibility
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to hex string
    const hashHex = (hash >>> 0).toString(16).padStart(8, "0");
    return hashHex.repeat(8).substring(0, 64); // Make it look like a SHA-256 hash length
  };

  _internalSetInitialState();
  browserConfigured = true;
}
