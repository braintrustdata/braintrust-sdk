import iso from "./isomorph";
import { _internalSetInitialState } from "./logger";

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
  try {
    if (typeof AsyncLocalStorage !== "undefined") {
      iso.newAsyncLocalStorage = <T>() => new AsyncLocalStorage<T>();
    }
  } catch {
    // Ignore
  }

  _internalSetInitialState();
  browserConfigured = true;
}
