import { AIStreamCallbacksAndOptions, formatStreamPart } from "ai";
import { BraintrustStream, BraintrustStreamChunk } from "braintrust";
import { ReadableStream, TransformStream } from "stream/web";

export type BraintrustStreamOrReadable =
  | BraintrustStream
  | ReadableStream<BraintrustStreamChunk>
  | ReadableStream<string>
  | ReadableStream<Uint8Array>;

export function toAIStream(
  stream: BraintrustStreamOrReadable,
  callbacks?: AIStreamCallbacksAndOptions,
): ReadableStream<Uint8Array> {
  const btStream =
    stream instanceof BraintrustStream ? stream : new BraintrustStream(stream);

  return btStream
    .toReadableStream()
    .pipeThrough(btStreamToAISDKTransformStream(callbacks));
}

export function toAIStreamResponse(
  stream: BraintrustStreamOrReadable,
  init?: ResponseInit,
): Response {
  return new Response(toAIStream(stream), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    ...init,
  });
}

function btStreamToAISDKTransformStream(
  callbacks?: AIStreamCallbacksAndOptions,
) {
  const encoder = new TextEncoder();
  const jsonChunks: string[] = [];
  const textChunks: string[] = [];
  return new TransformStream<BraintrustStreamChunk, Uint8Array>({
    async start(controller) {
      if (callbacks?.onStart) {
        await callbacks.onStart();
      }
    },
    async transform(chunk, controller) {
      switch (chunk.type) {
        case "text_delta":
          controller.enqueue(
            encoder.encode(formatStreamPart("text", chunk.data)),
          );

          // Call me old fashioned, but I think it's worth checking the existence of
          // each function to avoid unnecessary context switches.
          if (callbacks?.onToken) {
            await callbacks.onToken(chunk.data);
          }
          if (callbacks?.onText) {
            await callbacks.onText(chunk.data);
          }

          if (callbacks?.onCompletion || callbacks?.onFinal) {
            textChunks.push(chunk.data);
          }

          break;
        case "json_delta":
          jsonChunks.push(chunk.data);
          break;
      }
    },
    async flush(controller) {
      if (jsonChunks.length > 0) {
        const jsonString = jsonChunks.join("");
        const data = JSON.parse(jsonString);
        controller.enqueue(encoder.encode(formatStreamPart("data", data)));
        if (callbacks?.onFinal) {
          await callbacks.onFinal(jsonString);
        }
      } else {
        const textData = textChunks.join("");
        if (callbacks?.onCompletion) {
          await callbacks.onCompletion(textData);
        }
        if (callbacks?.onFinal) {
          await callbacks.onFinal(textData);
        }
      }

      controller.terminate();
    },
  });
}
