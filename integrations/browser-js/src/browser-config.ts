import {
  _internalIso as iso,
  _internalSetInitialState,
  BraintrustState,
} from "braintrust";
import { BRAINTRUST_STATE_SYMBOL_NAME } from "braintrust/symbol-name";
import { AsyncLocalStorage as BrowserAsyncLocalStorage } from "als-browser";

export function configureBrowser() {
  // Set build type indicator
  iso.buildType = "browser";

  iso.newAsyncLocalStorage = <T>() => new BrowserAsyncLocalStorage<T>();

  iso.getEnv = (name: string) => {
    if (typeof process === "undefined" || typeof process.env === "undefined") {
      return undefined;
    }
    return process.env[name];
  };

  // noop implementations for git config
  iso.getRepoInfo = async () => ({
    commit: null,
    branch: null,
    tag: null,
    dirty: false,
  });
  iso.getCallerLocation = () => undefined;

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
}
