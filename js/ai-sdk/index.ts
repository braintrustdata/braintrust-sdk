import { formatStreamPart } from "ai";
import type { BraintrustStreamChunk } from "braintrust";
import { ReadableStream, TransformStream } from "web-streams-polyfill";
// export { wrapAISDKModel } from "../src/wrappers/ai-sdk";

interface BraintrustStream {
  toReadableStream: () => ReadableStream<BraintrustStreamChunk>;
}

export function toAISDKStream(
  stream: BraintrustStream,
): ReadableStream<Uint8Array> {
  return stream
    .toReadableStream()
    .pipeThrough(btStreamToAISDKTransformStream());
}

export function toAISDKResponse(stream: BraintrustStream): Response {
  return new Response(toAISDKStream(stream), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function btStreamToAISDKTransformStream() {
  const encoder = new TextEncoder();
  const jsonChunks: string[] = [];
  return new TransformStream<BraintrustStreamChunk, Uint8Array>({
    async transform(chunk, controller) {
      switch (chunk.type) {
        case "text_delta":
          controller.enqueue(
            encoder.encode(formatStreamPart("text", chunk.data)),
          );
          break;
        case "json_delta":
          jsonChunks.push(chunk.data);
          break;
      }
    },
    async flush(controller) {
      if (jsonChunks.length > 0) {
        const data = JSON.parse(jsonChunks.join(""));
        controller.enqueue(encoder.encode(formatStreamPart("data", data)));
      }
      controller.terminate();
    },
  });
}
