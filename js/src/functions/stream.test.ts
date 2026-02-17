import { expect, test } from "vitest";
import {
  BraintrustStream,
  BraintrustStreamChunk,
  createFinalValuePassThroughStream,
} from "./stream";

const cases: {
  chunks: (string | Uint8Array | BraintrustStreamChunk)[];
  expected: string;
}[] = [
  {
    chunks: [
      { type: "text_delta", data: "Hello, " },
      { type: "text_delta", data: "world!" },
    ],
    expected: "Hello, world!",
  },
];

test("final value passthrough", async () => {
  for (const { chunks, expected } of cases) {
    const inputStream = new ReadableStream({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(c);
        }
        controller.close();
      },
    });

    const sinkChunks: BraintrustStreamChunk[] = [];
    const sink = new WritableStream<BraintrustStreamChunk>({
      write(chunk) {
        sinkChunks.push(chunk);
      },
    });

    let finalValue: unknown = null;
    await inputStream
      .pipeThrough(
        createFinalValuePassThroughStream(
          (v) => {
            finalValue = v;
          },
          (e) => {
            console.error("ERROR", e);
          },
        ),
      )
      .pipeTo(sink);

    expect(finalValue).toBe(expected);
    expect(sinkChunks.map((c) => c.data).join("")).toEqual(expected);
  }
});

test("final value passthrough with abort", async () => {
  const inputStream = new ReadableStream({
    start() {},
  });

  const controller = new AbortController();
  const stream = new BraintrustStream(inputStream, {
    signal: controller.signal,
  });

  controller.abort();

  await expect(stream.finalValue()).rejects.toThrow(
    "This operation was aborted",
  );
});

test("handles multi-byte UTF-8 characters split across chunks", async () => {
  // The emoji 😊 is encoded as: F0 9F 98 8A (4 bytes)
  const eventWithEmoji = `event: text_delta\ndata: "Hello 😊 world"\n\n`;
  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(eventWithEmoji);

  // Split the bytes so that the emoji is split across two chunks
  // Find where the emoji starts in the byte array
  const emojiStart = eventWithEmoji.indexOf("😊");
  const bytesBeforeEmoji = encoder.encode(
    eventWithEmoji.slice(0, emojiStart + 1),
  );

  // Split right in the middle of the 4-byte emoji sequence
  const splitPoint = bytesBeforeEmoji.length + 2; // Split after 2 bytes of the emoji
  const chunk1 = fullBytes.slice(0, splitPoint);
  const chunk2 = fullBytes.slice(splitPoint);

  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk1);
      controller.enqueue(chunk2);
      controller.close();
    },
  });

  const stream = new BraintrustStream(inputStream);

  // Use finalValue() to test the complete flow
  const finalValue = await stream.finalValue();

  // Verify the emoji was correctly decoded
  expect(finalValue).toBe("Hello 😊 world");
});

test("handles multiple multi-byte UTF-8 characters across many chunks", async () => {
  // Test with multiple emojis and international characters
  const events = [
    `event: text_delta\ndata: "🎉"\n\n`,
    `event: text_delta\ndata: "こんにちは"\n\n`,
    `event: text_delta\ndata: "🌟"\n\n`,
  ];

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  // Split each event into very small chunks to maximize the chance
  // of splitting multi-byte sequences
  for (const event of events) {
    const bytes = encoder.encode(event);
    // Split into chunks of 5 bytes each
    for (let i = 0; i < bytes.length; i += 5) {
      chunks.push(bytes.slice(i, Math.min(i + 5, bytes.length)));
    }
  }

  const inputStream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const stream = new BraintrustStream(inputStream);

  // Use finalValue() to test the complete flow
  const finalValue = await stream.finalValue();

  // Verify all characters were correctly decoded
  expect(finalValue).toBe("🎉こんにちは🌟");
});
