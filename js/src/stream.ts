import {
  createParser,
  EventSourceParser,
  ParsedEvent,
  ReconnectInterval,
} from "eventsource-parser";

export type BraintrustStreamChunk =
  | {
      type: "text_delta";
      data: string;
    }
  | {
      type: "json_delta";
      data: string;
    };

export class BraintrustStream {
  private stream: ReadableStream<BraintrustStreamChunk>;

  constructor(baseStream: ReadableStream<Uint8Array>);
  constructor(stream: ReadableStream<string>);
  constructor(stream: ReadableStream<BraintrustStreamChunk>);
  constructor(
    baseStream:
      | ReadableStream<Uint8Array>
      | ReadableStream<string>
      | ReadableStream<BraintrustStreamChunk>,
  ) {
    this.stream = baseStream.pipeThrough(btStreamParser());
  }

  public copy(): BraintrustStream {
    // Once a stream is tee'd, it is essentially consumed, so we need to replace our own
    // copy of it.
    const [newStream, copyStream] = this.stream.tee();
    this.stream = copyStream;
    return new BraintrustStream(newStream);
  }

  public toReadableStream(): ReadableStream<BraintrustStreamChunk> {
    return this.stream;
  }
}

function btStreamParser() {
  const decoder = new TextDecoder();
  let parser: EventSourceParser;
  return new TransformStream<
    Uint8Array | string | BraintrustStreamChunk,
    BraintrustStreamChunk
  >({
    async start(controller) {
      parser = createParser((event: ParsedEvent | ReconnectInterval) => {
        if (event.type === "reconnect-interval") {
          return;
        }
        switch (event.event) {
          case "text_delta":
            controller.enqueue({
              type: "text_delta",
              data: JSON.parse(event.data),
            });
            break;
          case "json_delta":
            controller.enqueue({
              type: "json_delta",
              data: event.data,
            });
            break;
          case "done":
            // Do nothing
            break;
          default:
            throw new Error(`Unknown event type ${event.event}`);
        }
      });
    },
    async transform(chunk, controller) {
      if (chunk instanceof Uint8Array) {
        parser.feed(decoder.decode(chunk));
      } else if (typeof chunk === "string") {
        parser.feed(chunk);
      } else {
        controller.enqueue(chunk);
      }
    },
    async flush(controller) {
      controller.terminate();
    },
  });
}

export function createFinalValuePassThroughStream<
  T extends BraintrustStreamChunk | string | Uint8Array,
>(
  onFinal: (result: unknown) => void,
): TransformStream<T, BraintrustStreamChunk> {
  const decoder = new TextDecoder();
  const textChunks: string[] = [];
  const jsonChunks: string[] = [];

  const transformStream = new TransformStream<T, BraintrustStreamChunk>({
    transform(chunk, controller) {
      if (typeof chunk === "string") {
        textChunks.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        textChunks.push(decoder.decode(chunk));
      } else {
        const chunkType = chunk.type;
        switch (chunkType) {
          case "text_delta":
            textChunks.push(chunk.data);
            break;
          case "json_delta":
            jsonChunks.push(chunk.data);
            break;
          default:
            const _type: never = chunkType;
            throw new Error(`Unknown chunk type ${_type}`);
        }
        controller.enqueue(chunk);
      }
    },
    flush(controller) {
      if (jsonChunks.length > 0) {
        // If we received both text and json deltas in the same stream, we
        // only return the json delta
        onFinal(JSON.parse(jsonChunks.join("")));
      } else if (textChunks.length > 0) {
        onFinal(textChunks.join(""));
      } else {
        onFinal(undefined);
      }

      controller.terminate();
    },
  });

  return transformStream;
}

export function devNullWritableStream(): WritableStream {
  return new WritableStream({
    write(chunk) {},
    close() {},
    abort(reason) {},
    start(controller) {},
  });
}
