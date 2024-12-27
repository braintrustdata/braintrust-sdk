import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import {
  registerConfigureHook,
  setContextVariable,
} from "@langchain/core/context";
import {
  BraintrustCallbackHandler,
  BraintrustCallbackHandlerOptions,
} from "./BraintrustCallbackHandler";

const BT_HANDLER = "BT_HANDLER";

export const init = ({
  handler,
  options,
}: Partial<{
  handler: BaseCallbackHandler;
  options: Partial<BraintrustCallbackHandlerOptions>;
}>) => {
  setContextVariable(
    BT_HANDLER,
    handler ?? new BraintrustCallbackHandler(options),
  );

  registerConfigureHook({
    contextVar: BT_HANDLER,
  });
};
