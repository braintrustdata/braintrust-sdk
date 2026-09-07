import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";

/** Record actual provider frames; replay requires the same client event sequence. */
export async function realtimeCassette({ transport, model, beta }) {
  const mode =
    process.env.BRAINTRUST_E2E_REALTIME_CASSETTE_MODE ??
    process.env.BRAINTRUST_E2E_CASSETTE_MODE ??
    "replay";
  assert.ok(
    ["record", "replay"].includes(mode),
    `Unsupported cassette mode: ${mode}`,
  );
  const directory = process.env.BRAINTRUST_E2E_CASSETTE_PATH;
  assert.ok(directory, "Realtime tests require the cassette harness");
  const file = join(
    directory,
    `${process.env.BRAINTRUST_E2E_CASSETTE_VARIANT}.${transport}.realtime.json`,
  );
  const recording = mode === "record";
  const tape = recording
    ? { model, beta, events: [] }
    : JSON.parse(await readFile(file, "utf8"));
  assert.equal(tape.model, model);
  assert.equal(tape.beta, beta);
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  let upstream;
  let cursor = 0;
  let failure;
  const fail = (error) => {
    failure ??= error;
    for (const socket of server.clients) socket.close(1011, "Cassette failure");
  };
  server.on("connection", (socket) => {
    if (recording) {
      // Credentials are sent only to OpenAI. Handshake headers are never recorded.
      assert.ok(
        process.env.OPENAI_API_KEY,
        "Recording requires OPENAI_API_KEY",
      );
      upstream = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            ...(beta ? { "OpenAI-Beta": "realtime=v1" } : {}),
          },
        },
      );
      upstream.on("error", fail);
      upstream.on("message", (bytes) => {
        const event = JSON.parse(bytes.toString());
        if (socket.readyState !== WebSocket.OPEN) return;
        // Ephemeral credentials are not needed to replay model events.
        if (event.session?.client_secret) delete event.session.client_secret;
        tape.events.push({ direction: "server", event });
        socket.send(JSON.stringify(event));
      });
      upstream.on("close", () => socket.close());
      socket.on("message", (bytes) => {
        const event = JSON.parse(bytes.toString());
        tape.events.push({ direction: "client", event });
        upstream.send(bytes.toString());
      });
      socket.on("close", () => upstream.close());
    } else {
      const advance = () => {
        while (tape.events[cursor]?.direction === "server") {
          socket.send(JSON.stringify(tape.events[cursor++].event));
        }
      };
      socket.on("message", (bytes) => {
        try {
          const expected = tape.events[cursor++];
          assert.equal(
            expected?.direction,
            "client",
            "Unexpected Realtime client event",
          );
          assert.deepEqual(JSON.parse(bytes.toString()), expected.event);
          advance();
        } catch (error) {
          fail(error);
        }
      });
      advance();
    }
    socket.on("error", fail);
  });
  return {
    port: server.address().port,
    async close() {
      if (upstream && upstream.readyState !== WebSocket.CLOSED) {
        const closed = once(upstream, "close");
        upstream.close();
        await closed;
      }
      for (const socket of server.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
      if (failure) throw failure;
      if (recording) {
        await mkdir(directory, { recursive: true });
        await writeFile(file, JSON.stringify(tape, null, 2) + "\n");
      } else {
        assert.equal(
          cursor,
          tape.events.length,
          "Unconsumed Realtime cassette events",
        );
      }
    },
  };
}
