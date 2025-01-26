import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import {
  registerConfigureHook,
  setContextVariable,
} from "@langchain/core/context";

const BT_HANDLER = "BT_HANDLER";

export const setGlobalHandler = (handler: BaseCallbackHandler) => {
  setContextVariable(BT_HANDLER, handler);

  registerConfigureHook({
    contextVar: BT_HANDLER,
  });
};

export const clearGlobalHandler = () => {
  setContextVariable(BT_HANDLER, undefined);
};
