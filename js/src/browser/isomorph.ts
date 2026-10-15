import type { Common } from "../isomorph-base";
export type {
  CallerLocation,
  IsoAsyncLocalStorage,
  IsoTracingChannel,
  IsoChannelHandlers,
} from "../isomorph-base";
import { createBrowserIsomorph } from "./platform";
const iso: Common = /* @__PURE__ */ createBrowserIsomorph();
export default iso;
