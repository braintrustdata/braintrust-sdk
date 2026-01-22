import iso from "./isomorph";
import { _internalSetInitialState } from "./logger";
import { registerTemplateRenderer } from "./template/registry";

// This is copied from next.js. It seems they define AsyncLocalStorage in the edge
// environment, even though it's not defined in the browser.
import type { AsyncLocalStorage as NodeAsyncLocalStorage } from "async_hooks";

declare global {
  var AsyncLocalStorage: typeof NodeAsyncLocalStorage;
}
// End copied code

let browserConfigured = false;
export function configureBrowser() {
  if (browserConfigured) {
    return;
  }

  // Set build type indicator
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

  registerTemplateRenderer("nunjucks", {
    render() {
      throw new Error(
        "Nunjucks templating is not supported in this build. Use templateFormat: 'mustache' (or omit templateFormat).",
      );
    },
    lint() {
      throw new Error(
        "Nunjucks templating is not supported in this build. Use templateFormat: 'mustache' (or omit templateFormat).",
      );
    },
  });

  _internalSetInitialState();
  browserConfigured = true;
}
