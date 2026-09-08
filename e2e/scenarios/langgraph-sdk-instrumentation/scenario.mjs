import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import * as braintrust from "braintrust";
import {
  runMain,
  runTracedScenario,
  runOperation,
} from "../../helpers/provider-runtime.mjs";

const packageName = process.env.LANGGRAPH_SDK_PACKAGE;
const { Client } =
  process.env.LANGGRAPH_SDK_MODULE === "cjs"
    ? createRequire(import.meta.url)(packageName)
    : await import(packageName);
const input = { messages: [{ role: "user", content: "Hello" }] };
const output = {
  messages: [
    {
      type: "ai",
      id: "answer",
      content: "Hello world",
      usage_metadata: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    },
  ],
};
const metadata = { run_id: "remote-run" };
const messageChunks = [
  { event: "metadata", data: metadata },
  {
    event: "messages",
    data: [
      { id: "answer", type: "AIMessageChunk", content: "" },
      { private: "DO_NOT_CAPTURE" },
    ],
  },
  {
    event: "messages",
    data: [{ id: "answer", type: "AIMessageChunk", content: "Hello " }, {}],
  },
  {
    event: "messages",
    data: [
      {
        id: "answer",
        type: "AIMessageChunk",
        content: "world",
        usage_metadata: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      },
      {},
    ],
  },
];

// A local LangGraph HTTP endpoint exercises real SDK serialization and SSE
// parsing without requiring a hosted deployment or recording credentials.
runMain(async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    requests.push({ path: req.url, payload });
    if (payload.assistant_id === "http-error") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "Invalid assistant" }));
    } else if (req.url.endsWith("/stream")) {
      const events =
        payload.assistant_id === "stream-error"
          ? [
              ...messageChunks,
              {
                event: "error",
                data: { error: "ValueError", message: "Agent failed" },
              },
            ]
          : payload.assistant_id === "updates"
            ? [
                { event: "updates", data: { agent: { answer: "first" } } },
                { event: "updates", data: { agent: { answer: "last" } } },
              ]
            : payload.assistant_id === "messages"
              ? messageChunks
              : [...messageChunks, { event: "values", data: output }];
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of events)
        res.write(
          `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
        );
      res.end();
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          req.url.endsWith("/wait")
            ? payload.assistant_id === "wait-error"
              ? { __error__: { error: "ValueError", message: "Agent failed" } }
              : output
            : req.url === "/threads"
              ? { thread_id: "created-thread" }
              : {
                  run_id: "remote-run",
                  thread_id: "thread",
                  assistant_id: "agent",
                  status: "pending",
                  metadata: { secret: "DO_NOT_CAPTURE" },
                },
        ),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const raw = new Client({
      apiUrl: `http://127.0.0.1:${server.address().port}`,
      apiKey: null,
      callerOptions: { maxRetries: 0 },
    });
    const wrapped = process.env.LANGGRAPH_SDK_MODE !== "auto";
    const client = wrapped ? braintrust.wrapLangGraphSDK(raw) : raw;
    if (wrapped) assert.equal(braintrust.wrapLangGraphSDK(client), client);
    assert.equal(client.threads, raw.threads);
    const options = {
      input,
      metadata: { secret: "DO_NOT_CAPTURE" },
      config: { configurable: { secret: "DO_NOT_CAPTURE" } },
      context: { secret: "DO_NOT_CAPTURE" },
    };
    await runTracedScenario({
      projectNameBase: "tmp-luca-langgraph-sdk-e2e",
      rootName: "langgraph-sdk-instrumentation",
      metadata: { scenario: "langgraph-sdk-instrumentation" },
      callback: async () => {
        await runOperation("create", "create", async () => {
          assert.equal(
            (await client.runs.create("thread", "agent", options)).status,
            "pending",
          );
          await client.runs.join("thread", "remote-run");
        });
        await runOperation("wait", "wait", async () => {
          assert.deepEqual(
            await client.runs.wait(null, "agent", options),
            output,
          );
        });
        await runOperation("resume", "resume", async () => {
          assert.deepEqual(
            await client.runs.wait("thread", "agent", {
              command: { resume: "yes" },
              interruptBefore: ["tools"],
            }),
            output,
          );
        });
        for (const assistant of [
          "agent",
          "messages",
          "updates",
          "stream-error",
        ]) {
          await runOperation(assistant, assistant, async () => {
            const stream = client.runs.stream("thread", assistant, {
              ...options,
              streamMode: ["values", "messages", "updates"],
              streamSubgraphs: true,
            });
            assert.equal(stream[Symbol.asyncIterator](), stream);
            assert.equal(typeof stream.return, "function");
            const events = [];
            for await (const event of stream) events.push(event);
            if (assistant === "agent")
              assert.deepEqual(events.at(-1).data, output);
            if (assistant === "stream-error")
              assert.equal(events.at(-1).event, "error");
            // Consuming a provider stream must not leak its span into user code.
            await braintrust.traced(() => {}, { name: "after-stream" });
          });
        }
        await runOperation("cancel", "cancel", async () => {
          const stream = client.runs.stream(null, "agent", options);
          assert.deepEqual((await stream.next()).value, {
            event: "metadata",
            data: metadata,
            id: undefined,
          });
          await stream.return();
        });
        await runOperation("http-error", "http-error", async () => {
          await assert.rejects(
            client.runs.wait(null, "http-error", options),
            /Invalid assistant/,
          );
        });
        await runOperation("wait-error", "wait-error", async () => {
          await assert.rejects(
            client.runs.wait(null, "wait-error", options),
            /Agent failed/,
          );
        });
        await runOperation(
          "wait-error-returned",
          "wait-error-returned",
          async () => {
            assert.ok(
              (
                await client.runs.wait(null, "wait-error", {
                  ...options,
                  raiseError: false,
                })
              ).__error__,
            );
          },
        );
        await runOperation("parallel", "parallel", async () => {
          await Promise.all(
            ["left", "right"].map((name) =>
              runOperation(name, name, () =>
                client.runs.wait(name, "agent", { input: name }),
              ),
            ),
          );
        });
        await runOperation(
          "thread-controller",
          "thread-controller",
          async () => {
            // Background/controller APIs remain usable without tracing or patches.
            const thread = client.threads.stream("thread-controller", {
              assistantId: "agent",
              transport: {
                threadId: "thread-controller",
                async open() {},
                async close() {},
                async *events() {},
                async send(command) {
                  return {
                    type: "response",
                    id: command.id,
                    result: { run_id: "background-run" },
                  };
                },
                openEventStream() {
                  return {
                    ready: Promise.resolve(),
                    close() {},
                    events: (async function* () {})(),
                  };
                },
              },
            });
            assert.deepEqual(await thread.run.start({ input: "background" }), {
              run_id: "background-run",
            });
            await thread.close();
          },
        );
        // Thread CRUD is deliberately outside the generation tracing surface.
        await client.threads.create();
      },
    });
    assert.equal(
      requests.filter(({ path }) => path === "/runs/wait").length,
      4,
    );
    assert.deepEqual(requests[0].payload.input, input);
    assert.equal(requests[0].payload.metadata.secret, "DO_NOT_CAPTURE");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
