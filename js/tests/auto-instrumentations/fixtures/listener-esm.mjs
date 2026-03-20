import { tracingChannel } from "node:diagnostics_channel";
import { parentPort } from "node:worker_threads";
import * as dc from "node:diagnostics_channel";

const events = { start: [], end: [], error: [] };
// NOTE: code-transformer prepends "orchestrion:openai:" to the channel name
const expectedChannel = "orchestrion:openai:chat.completions.create";

// Get the kStoreKey symbol to access the store
const kStoreKey = dc.kStoreKey || Symbol.for("diagnostics_channel.store");

function serializeResult(ctx) {
  try {
    return ctx.result ? JSON.parse(JSON.stringify(ctx.result)) : null;
  } catch {
    return { hasResult: ctx.result !== undefined };
  }
}

// Subscribe to the channel and accumulate events
const channel = tracingChannel(expectedChannel);
channel.subscribe({
  start: (ctx) => {
    // Arguments are stored in the Symbol(diagnostics_channel.store)
    const store = ctx[kStoreKey];
    events.start.push({
      args: store?.arguments ? Array.from(store.arguments) : [],
      self: !!store?.self,
    });
  },
  end: (ctx) => {
    events.end.push({
      result: serializeResult(ctx),
    });
  },
  asyncEnd: (ctx) => {
    events.end.push({
      result: serializeResult(ctx),
    });
  },
  error: (ctx) => {
    events.error.push({ error: String(ctx.error) });
  },
});

// Send all accumulated events on exit
process.on("beforeExit", () => {
  parentPort?.postMessage({ type: "events", events });
});
