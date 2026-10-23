import { configureInstrumentation } from "braintrust/instrumentation";
configureInstrumentation({
  ...(process.env.LIVEKIT_SEGMENTS === "1"
    ? { streamingAttachmentBufferBytes: 19200 } // 200 ms of 24 kHz stereo s16le.
    : {}),
  integrations: {
    livekit:
      process.env.LIVEKIT_INTEGRATION === "off"
        ? false
        : process.env.LIVEKIT_AUDIO_MIDDLEWARE === "1"
          ? {
              audioMiddleware: () => [
                async (segment, meta, next) => {
                  const result = await next(segment, meta);
                  console.log(
                    JSON.stringify({
                      audioMiddlewareSegment: result.meta.index,
                    }),
                  );
                  return result;
                },
              ],
            }
          : true,
  },
  spanCustomizers: [
    {
      onSpanExport(data) {
        data.metadata = {
          ...data.metadata,
          scenario: "livekit-instrumentation",
          testRunId: process.env.BRAINTRUST_E2E_RUN_ID,
        };
        return data;
      },
    },
  ],
});
