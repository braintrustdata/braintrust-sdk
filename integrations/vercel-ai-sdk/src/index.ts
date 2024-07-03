import { formatStreamPart } from "ai";
import type { BraintrustStreamChunk, BraintrustStream } from "braintrust";
import { ReadableStream, TransformStream } from "stream/web";

export function toVercelAISDKStream(
  stream: BraintrustStream,
): ReadableStream<Uint8Array> {
  return stream
    .toReadableStream()
    .pipeThrough(btStreamToAISDKTransformStream());
}

export function toVercelAISDKResponse(stream: BraintrustStream): Response {
  return new Response(toVercelAISDKStream(stream), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
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
