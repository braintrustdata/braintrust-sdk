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
    start(controller) {
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
    transform(chunk, controller) {
      if (chunk instanceof Uint8Array) {
        parser.feed(decoder.decode(chunk));
      } else if (typeof chunk === "string") {
        parser.feed(chunk);
      } else {
        controller.enqueue(chunk);
      }
    },
    flush(controller) {
      controller.terminate();
    },
  });
}
