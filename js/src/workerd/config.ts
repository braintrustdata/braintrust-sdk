import iso from "../isomorph";
import { _internalSetInitialState } from "../logger";

import type { AsyncLocalStorage as NodeAsyncLocalStorage } from "async_hooks";

declare global {
  var AsyncLocalStorage: typeof NodeAsyncLocalStorage;
}

let workerdConfigured = false;

/**
 * Configure the isomorph for Cloudflare Workers (workerd) runtime.
 */
export function configureWorkerd(): void {
  if (workerdConfigured) {
    return;
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
  workerdConfigured = true;
}
