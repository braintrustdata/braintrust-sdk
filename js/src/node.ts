import { AsyncLocalStorage } from "node:async_hooks";

import iso from "./isomorph";
import { getRepoInfo, getPastNAncestors } from "./gitutil";
import { getCallerLocation } from "./stackutil";
import { _internalSetInitialState } from "./logger";

export function configureNode() {
  iso.getRepoInfo = getRepoInfo;
  iso.getPastNAncestors = getPastNAncestors;
  iso.getEnv = (name) => process.env[name];
  iso.getCallerLocation = getCallerLocation;
  iso.newAsyncLocalStorage = <T>() => new AsyncLocalStorage<T>();
  iso.processOn = (event: string, handler: (code: any) => void) => {
    process.on(event, handler);
  };

  _internalSetInitialState();
}
