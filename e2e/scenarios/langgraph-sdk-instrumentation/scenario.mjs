import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
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
const input = {
  messages: [
    { role: "user", content: "Reply with exactly: hello from langgraph" },
  ],
};

runMain(async () => {
  const server = fork(new URL("./server.mjs", import.meta.url), [], {
    execArgv: [],
    env: {
      ...process.env,
      LANGSMITH_TRACING: "false",
      LANGSMITH_TRACING_V2: "false",
      LANGCHAIN_TRACING: "false",
      LANGCHAIN_TRACING_V2: "false",
      LOG_LEVEL: "error",
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const exited = once(server, "exit");
  try {
    const { apiUrl } = await Promise.race([
      once(server, "message").then(([message]) => message),
      exited.then(([code]) => {
        throw new Error(`LangGraph server exited before startup: ${code}`);
      }),
    ]);
    const raw = new Client({
      apiUrl,
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
          const thread = await client.threads.create();
          const run = await client.runs.create(
            thread.thread_id,
            "agent",
            options,
          );
          assert.ok(run.run_id);
          await client.runs.join(thread.thread_id, run.run_id);
          assert.equal(
            (await client.runs.get(thread.thread_id, run.run_id)).status,
            "success",
          );
        });
        await runOperation("wait", "wait", async () => {
          const state = await client.runs.wait(null, "agent", options);
          assert.ok(state.messages.at(-1).content.length > 0);
          assert.ok(state.messages.at(-1).usage_metadata.total_tokens > 0);
        });
        const thread = await client.threads.create();
        await runOperation("interrupt", "interrupt", async () => {
          const state = await client.runs.wait(
            thread.thread_id,
            "approval",
            options,
          );
          assert.equal(state.__interrupt__[0].value, "Approve the model call?");
        });
        await runOperation("resume", "resume", async () => {
          const state = await client.runs.wait(thread.thread_id, "approval", {
            command: { resume: "yes" },
          });
          assert.ok(state.messages.at(-1).content.length > 0);
          assert.ok(state.messages.at(-1).usage_metadata.total_tokens > 0);
        });
        for (const [name, streamMode] of [
          ["values", ["values", "messages", "updates"]],
          ["messages", ["messages"]],
          ["updates", ["updates"]],
          ["stream-error", ["values", "messages"]],
        ]) {
          await runOperation(name, name, async () => {
            const stream = client.runs.stream(
              null,
              name === "stream-error" ? "failing" : "agent",
              {
                ...options,
                streamMode,
                streamSubgraphs: true,
              },
            );
            assert.equal(stream[Symbol.asyncIterator](), stream);
            assert.equal(typeof stream.return, "function");
            const events = [];
            for await (const event of stream) events.push(event);
            if (name === "values") {
              const final = events
                .filter((event) => event.event === "values")
                .at(-1).data;
              assert.ok(final.messages.at(-1).content.length > 0);
              assert.ok(final.messages.at(-1).usage_metadata.total_tokens > 0);
            }
            if (name === "messages")
              assert.ok(
                events.some((event) => event.event.startsWith("messages")),
              );
            if (name === "updates")
              assert.ok(
                events.some(
                  (event) => event.event === "updates" && event.data.agent,
                ),
              );
            if (name === "stream-error")
              assert.equal(events.at(-1).event, "error");
            await braintrust.traced(() => {}, { name: "after-stream" });
          });
        }
        await runOperation("cancel", "cancel", async () => {
          // Interrupt before generation so disconnect timing cannot leave an
          // in-flight model request in the cassette or affect subsequent runs.
          const stream = client.runs.stream(null, "agent", {
            ...options,
            interruptBefore: ["agent"],
            onDisconnect: "cancel",
          });
          assert.equal((await stream.next()).value.event, "metadata");
          await stream.return();
        });
        await runOperation("http-error", "http-error", async () => {
          await assert.rejects(
            client.runs.wait(null, "missing-assistant", options),
            /HTTP 404: No assistant found/,
          );
        });
        await runOperation("wait-error", "wait-error", async () => {
          await assert.rejects(
            client.runs.wait(null, "failing", options),
            /Agent failed/,
          );
        });
        await runOperation(
          "wait-error-returned",
          "wait-error-returned",
          async () => {
            assert.ok(
              (
                await client.runs.wait(null, "failing", {
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
              runOperation(name, name, async () => {
                const state = await client.runs.wait(null, "agent", {
                  input: {
                    messages: [
                      { role: "user", content: `Reply with exactly: ${name}` },
                    ],
                  },
                });
                assert.ok(state.messages.at(-1).content.includes(name));
              }),
            ),
          );
        });
      },
    });
  } finally {
    if (server.connected) server.disconnect();
    const killTimer = setTimeout(() => server.kill("SIGKILL"), 5_000);
    try {
      await exited;
    } finally {
      clearTimeout(killTimer);
    }
  }
});
