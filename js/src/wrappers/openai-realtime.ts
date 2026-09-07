import { openAIChannels } from "../instrumentation/plugins/openai-channels";
import type { OpenAIRealtimeConnection } from "../vendor-sdk-types/openai-media";

/** Trace an OpenAIRealtimeWebSocket or OpenAIRealtimeWS connection and its model turns. */
export function wrapOpenAIRealtime<T extends object>(connection: T): T {
  if (
    !("on" in connection) ||
    typeof connection.on !== "function" ||
    !("send" in connection) ||
    typeof connection.send !== "function" ||
    !("close" in connection) ||
    typeof connection.close !== "function"
  )
    return connection;
  const typed = connection as unknown as OpenAIRealtimeConnection;
  openAIChannels.realtimeConnect.invoke(
    (value) => value,
    undefined,
    [typed],
    {},
  );
  return connection;
}
