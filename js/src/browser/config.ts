import iso from "../isomorph";
import { _internalSetInitialState } from "../logger";

import type { AsyncLocalStorage as NodeAsyncLocalStorage } from "async_hooks";

declare global {
  var AsyncLocalStorage: typeof NodeAsyncLocalStorage;
  var __BRAINTRUST_BROWSER_PKG__: boolean | undefined;
}

let messageShown = false;
let browserConfigured = false;

/**
 * Configure the isomorph for browser environments.
 */
export function configureBrowser(): void {
  if (browserConfigured) {
    return;
  }

  const isUsingBrowserPackage =
    typeof globalThis !== "undefined" && globalThis.__BRAINTRUST_BROWSER_PKG__;

  if (
    !isUsingBrowserPackage &&
    !messageShown &&
    typeof console !== "undefined"
  ) {
    console.info(
      "This entrypoint is no longer supported.\n\n" +
        "You should be using entrypoints:\n\n" +
        "- `/workerd` (cloudflare envs)\n" +
        "- `/edge-light` (next-js or other edge envs)\n\n" +
        "If you'd like to use braintrust in the browser use the dedicated package: @braintrust/browser\n",
    );
    messageShown = true;
  }

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

  iso.hash = (data: string): string => {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const hashHex = (hash >>> 0).toString(16).padStart(8, "0");
    return hashHex.repeat(8).substring(0, 64);
  };

  _internalSetInitialState();
  browserConfigured = true;
}
