import { channel, defineInterceptor } from "../core/interceptor-definitions";

import type { FlueObservableContext } from "../../vendor-sdk-types/flue";

export const flueChannels = defineInterceptor("@flue/runtime", {
  createContext: channel<[unknown], FlueObservableContext>({
    channelName: "createFlueContext",
  }),
});
