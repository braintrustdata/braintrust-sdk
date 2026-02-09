import { BROWSER_CONFIGURED_KEY } from "./symbols";

export {};

type BaseGlobalThis = typeof globalThis;

declare global {
  var globalThis: BaseGlobalThis & {
    [BROWSER_CONFIGURED_KEY]?: boolean;
  };
}
